// End-to-end test of the shared engine with both apps, in Chromium, with GitHub and Gemini mocked in memory.
// Usage: node tests/e2e.cjs   (expects ../de-karteikarten and ../eman-deutsch next to this repo;
//        override with AMR_DIR / EMAN_DIR, optional FONTCACHE dir with map.tsv, SHOTS dir for screenshots)
// The word lists are read from fixed commits of the two app repos (PIN below), so the checks do not change when
// new words are added and no personal data is stored here. The expected result for de-karteikarten is kept only
// as a SHA-256 of what its original engine produced (tests/fixtures/amr-expected.sha256).
// CAPTURE_FROM=<dir of an app with its own old app.js> records that hash from that engine.
let chromium; try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
const http = require("http"), fs = require("fs"), path = require("path"), vm = require("vm"), { execSync } = require("child_process");

const ENGINE = path.resolve(__dirname, ".."), FIX = path.join(ENGINE, "tests/fixtures");
const EMAN = process.env.EMAN_DIR || path.join(ENGINE, "../eman-deutsch"), AMR = process.env.AMR_DIR || path.join(ENGINE, "../de-karteikarten");
const FONTS = process.env.FONTCACHE, CAPTURE = process.env.CAPTURE_FROM;
const PIN = { amr: "6a235f1", eman: "4d3f634" };
const TMP = fs.mkdtempSync(path.join(require("os").tmpdir(), "kk-e2e-"));
const pinned = (dir, sha, name) => { const f = path.join(TMP, name); fs.writeFileSync(f, execSync(`git -C "${dir}" show ${sha}:cards.js`, { encoding: "utf8" })); return f; };
const AMR_CARDS = pinned(AMR, PIN.amr, "amr-cards.js"), EMAN_CARDS = pinned(EMAN, PIN.eman, "eman-cards.js");
const SHOTS = process.env.SHOTS || path.join(ENGINE, "tests/.shots"); fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log((ok ? "PASS " : "FAIL ") + name + (info !== undefined && !ok ? "  -> " + (typeof info === "string" ? info : JSON.stringify(info)).slice(0, 600) : "")); };
const b64 = s => Buffer.from(s, "utf8").toString("base64").replace(/(.{60})/g, "$1\n");
const unb64 = s => Buffer.from(s, "base64").toString("utf8");
const loadCards = src => { const c = { window: {} }; vm.runInNewContext(src, c); return c.window.CARDS; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- static server: serves /<repo>/<file> from a directory, with optional per-file overrides ----------
function serve(port, mounts) {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const m = Object.keys(mounts).find(pre => u.startsWith("/" + pre + "/"));
      if (!m) { resp.writeHead(404); return resp.end(); }
      let rel = u.slice(m.length + 2) || "index.html";
      const { dir, over = {} } = mounts[m];
      const file = over[rel] || path.join(dir, rel);
      fs.readFile(file, (err, data) => {
        if (err) { resp.writeHead(404); return resp.end(); }
        const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" }[path.extname(file)] || "application/octet-stream";
        resp.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); resp.end(data);
      });
    }).listen(port, "127.0.0.1", () => res(srv));
  });
}

// ---------- GitHub API mock (contents API on branches main/progress, refs) ----------
function makeGitHub(repo, files) {
  const store = {}; let n = 0; const log = [];
  const sha = () => "sha" + (++n);
  for (const [k, v] of Object.entries(files)) store[k] = { content: v, sha: sha() };
  async function handle(route) {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const base = `/repos/${repo}/`;
    const entry = { method, path: url.pathname, ref: url.searchParams.get("ref") };
    if (req.postData()) { try { entry.body = JSON.parse(req.postData()); } catch (e) { entry.body = req.postData(); } }
    log.push(entry);
    const json = (status, obj) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(obj) });
    if (!url.pathname.startsWith(base)) return json(404, { message: "Not Found" });
    const rest = url.pathname.slice(base.length);
    if (rest === "git/ref/heads/main") return json(200, { object: { sha: "mainsha" } });
    if (rest === "git/refs" && method === "POST") return json(201, {});
    const mm = rest.match(/^contents\/(.+)$/); if (!mm) return json(404, {});
    const file = mm[1];
    if (method === "GET") {
      const branch = entry.ref || "main", k = branch + ":" + file;
      if (!store[k]) return json(404, { message: "Not Found" });
      return json(200, { sha: store[k].sha, content: b64(store[k].content), encoding: "base64" });
    }
    if (method === "PUT") {
      const b = entry.body, k = (b.branch || "main") + ":" + file;
      if (store[k] && b.sha !== store[k].sha) return json(409, { message: "sha mismatch" });
      if (!store[k] && b.sha) return json(422, { message: "sha given for new file" });
      store[k] = { content: unb64(b.content), sha: sha() };
      return json(200, { content: { sha: store[k].sha } });
    }
    return json(405, {});
  }
  return { store, log, handle };
}

// ---------- Phrases (Wendungen) returned by the Gemini mock ----------
const PH_ONE = { w: "mir wirklich zu hoch", ar: "غالي عليا أوي", ex: "Die Miete ist <b>mir wirklich zu hoch</b>.", tr: "الإيجار غالي عليا أوي.", note: "", cat: "إبداء الرأي" };
const PH_STARTER = [
  { w: "Ich finde, dass …", ar: "أنا شايفة إن…", ex: "<b>Ich finde, dass</b> die Wohnung zu klein ist.", tr: "أنا شايفة إن الشقة صغيرة.", note: "", cat: "إبداء الرأي" },
  { w: "Also, …", ar: "يعني…", ex: "<b>Also</b>, ich weiß nicht genau.", tr: "يعني، مش عارفة بالظبط.", note: "بتقوليها وإنتي بتفكري", cat: "كسب الوقت" },
  { w: "Moment mal …", ar: "لحظة…", ex: "<b>Moment mal</b>, das stimmt nicht.", tr: "لحظة، ده مش صح.", note: "", cat: "كسب الوقت" },
  { w: "Mir wirklich zu hoch", ar: "مكرر", ex: "Das ist <b>mir wirklich zu hoch</b>.", tr: "مكرر", note: "", cat: "إبداء الرأي" },
  { w: "Also …", ar: "مكرر", ex: "<b>Also</b> gut.", tr: "مكرر", note: "", cat: "كسب الوقت" }
];

// ---------- Gemini mock ----------
function makeGemini() {
  const g = { calls: [], tts: [], lists: 0, mode: "ok", card: null };
  g.handle = async route => {
    const req = route.request();
    // Voice: model list and text-to-speech requests are logged apart from the card/practice calls
    if (req.method() === "GET") { g.lists++; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [
      { name: "models/gemini-9-pro-tts", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-9-flash-lite-tts", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-9-flash", supportedGenerationMethods: ["generateContent"] }] }) }); }
    const body = JSON.parse(req.postData());
    if (body.generationConfig && body.generationConfig.responseModalities) {
      g.tts.push({ url: req.url(), body });
      if (g.ttsDelay) await new Promise(r => setTimeout(r, g.ttsDelay));
      if (g.mode === "busy" || g.ttsMode === "busy") return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: Buffer.alloc(4800).toString("base64") } }] } }] }) });
    }
    g.calls.push({ url: req.url(), body });
    if (g.mode === "busy") return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    const out = typeof g.card === "function" ? g.card(g.calls[g.calls.length - 1].body) : g.card;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) });
  };
  return g;
}

async function newPage(browser, { storage = {}, dark = false, standalone = false, reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light", reducedMotion: reduced ? "reduce" : "no-preference", locale: "ar-EG" });
  await ctx.addInitScript(([st, sa]) => {
    if (!sessionStorage.getItem("__seeded")) { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); sessionStorage.setItem("__seeded", "1"); }
    if (sa) { const mm = window.matchMedia.bind(window); window.matchMedia = q => q.includes("display-mode: standalone") ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q); }
  }, [storage, standalone]);
  // Google Fonts from the local cache (downloaded with curl), everything else external is mocked
  const fontMap = FONTS ? Object.fromEntries(fs.readFileSync(FONTS + "/map.tsv", "utf8").trim().split("\n").map(l => l.split("\t"))) : {};
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
    const f = fontMap[route.request().url()];
    if (!f) return route.abort();
    route.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : "font/woff2", body: fs.readFileSync(FONTS + "/" + f), headers: { "Access-Control-Allow-Origin": "*" } });
  });
  const page = await ctx.newPage();
  page.errors = []; page.dialogs = [];
  page.on("pageerror", e => page.errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|Failed to load resource/.test(m.text())) page.errors.push("console: " + m.text()); });
  page.on("dialog", d => { page.dialogs.push(d.message()); d.accept(); });
  return { ctx, page };
}
const tab = (page, mode) => page.click(`nav button[data-mode=${mode}]`);
// Clears the toast, runs the action, then waits for the new toast it produces
const toastOf = async (page, action) => {
  await page.evaluate(() => { const t = document.querySelector("#toast"); t.hidden = true; t.textContent = ""; });
  await action();
  await page.waitForFunction(() => { const t = document.querySelector("#toast"); return !t.hidden && t.textContent; }, null, { timeout: 15000 });
  return page.textContent("#toast");
};

(async () => {
  const browser = await chromium.launch();
  const mounts = {
    "karteikarten-engine": { dir: ENGINE },
    "eman-deutsch": { dir: EMAN, over: { "cards.js": EMAN_CARDS } },
    "de-karteikarten": { dir: AMR, over: { "cards.js": AMR_CARDS } }
  };
  if (CAPTURE) mounts["amr-capture"] = { dir: CAPTURE, over: { "cards.js": AMR_CARDS } };
  // A long word list (Eman's cards plus synthetic ones) for the collapsing topics
  const bigCards = loadCards(fs.readFileSync(EMAN_CARDS, "utf8")).concat(Array.from({ length: 160 }, (_, i) => ({ id: "syn" + i, g: "x", w: "synthetisch" + i, cat: "موضوع " + (i % 6), ar: "تجريبي", ex: "x", tr: "x" })));
  const BIG_CARDS = path.join(SHOTS, "big-cards.js");
  fs.writeFileSync(BIG_CARDS, "window.CARDS = " + JSON.stringify(bigCards) + ";\n");
  mounts["eman-big"] = { dir: EMAN, over: { "cards.js": BIG_CARDS } };
  const srv = await serve(8123, mounts);
  const ORIGIN = "http://127.0.0.1:8123";

  // ===================== A. Amr's app must behave exactly like with his original engine =====================
  const amrCards = fs.readFileSync(AMR_CARDS, "utf8");
  const runAmr = async variant => {
    const gh = makeGitHub("amr-f-ramadan/de-karteikarten", { "main:cards.js": amrCards });
    const gem = makeGemini();
    gem.card = { w: "Kündigung", g: "die", hint: "Plural: die Kündigungen", perf: "", ar: "إنهاء عقد، استقالة", def: "Das Beenden eines Vertrags.", ex: "Ich habe die <b>Kündigung</b> bekommen.", note: "", fam: "kündigen", cat: "Arbeit" };
    const { ctx, page } = await newPage(browser, { storage: { "kk-amr-v2:gemini": "fake-key", "kk-amr-v2:token": "fake-token" } });
    await ctx.route("https://api.github.com/**", gh.handle);
    await ctx.route("https://generativelanguage.googleapis.com/**", gem.handle);
    await page.goto(`${ORIGIN}/${variant}/`);
    await sleep(2500);
    await tab(page, "list");
    await page.fill("#nw", "Kündigung");
    await page.click('[data-act="gen"]');
    await page.waitForSelector(".preview", { timeout: 8000 });
    const formIds = await page.$$eval(".preview [id]", els => els.map(e => e.id));
    const selLabels = await page.$$eval("#f_g option", els => els.map(e => e.textContent));
    await toastOf(page, () => page.click('[data-act="savecard"]'));
    const put = gh.log.find(e => e.method === "PUT" && e.path.endsWith("/cards.js"));
    const saved = put && unb64(put.body.content);
    const run = { request: gem.calls[0] && gem.calls[0].body, formIds, selLabels, savedLine: saved && saved.slice(amrCards.lastIndexOf("\n];")), savedPrefixOk: !!saved && saved.startsWith(amrCards.slice(0, amrCards.lastIndexOf("\n];"))) };
    const errors = page.errors; await ctx.close();
    return { run, errors };
  };
  const hash = run => require("crypto").createHash("sha256").update(JSON.stringify(run)).digest("hex");
  if (CAPTURE) { const { run } = await runAmr("amr-capture"); fs.writeFileSync(FIX + "/amr-expected.sha256", hash(run) + "\n"); console.log("captured tests/fixtures/amr-expected.sha256"); }
  const want = fs.readFileSync(FIX + "/amr-expected.sha256", "utf8").trim();
  const { run: got, errors: amrErrors } = await runAmr("de-karteikarten");
  if (process.env.DUMP_RUN) fs.writeFileSync(process.env.DUMP_RUN, JSON.stringify(got, null, 1));
  check("Amr: Gemini request, add form, article labels and saved card exactly as with his original engine", hash(got) === want, { formIds: got.formIds, savedLine: got.savedLine, promptStart: got.request && got.request.contents[0].parts[0].text.slice(0, 200) });
  check("Amr: no page errors", !amrErrors.length, amrErrors);

  // ===================== B. Eman's app =====================
  const emanCards = fs.readFileSync(EMAN_CARDS, "utf8");
  const CARDS = loadCards(emanCards);
  const remoteProgress = fs.readFileSync(FIX + "/sample-progress.json", "utf8");
  const RP = JSON.parse(remoteProgress);
  const allUiText = [];   // [state, text]
  const grab = async (page, state) => {
    const t = await page.evaluate(() => {
      const attrs = [...document.querySelectorAll("[placeholder],[aria-label],[title]")].map(e => [e.getAttribute("placeholder"), e.getAttribute("aria-label"), e.getAttribute("title")].filter(Boolean).join(" | "));
      return document.body.innerText + "\n" + attrs.join("\n");
    });
    allUiText.push([state, t]);
  };

  {
    const gh = makeGitHub("amr-f-ramadan/eman-deutsch", { "main:cards.js": emanCards, "progress:progress.json": remoteProgress });
    const gem = makeGemini();
    const { ctx, page } = await newPage(browser, { storage: { "kk-eman-v2:token": "fake-token" } });
    await ctx.route("https://api.github.com/**", gh.handle);
    await ctx.route("https://generativelanguage.googleapis.com/**", gem.handle);
    await page.goto(`${ORIGIN}/eman-deutsch/`);
    await sleep(2500);

    // Sync with her real remote progress
    const local = JSON.parse(await page.evaluate(() => localStorage.getItem("kk-eman-v2")));
    check("Eman: synced progress keeps her 4 article-quiz results", local && JSON.stringify(local.art) === JSON.stringify(RP.art), local && local.art);
    check("Eman: synced progress keeps cards/newDay/opts", local && JSON.stringify(local.cards) === JSON.stringify(RP.cards) && JSON.stringify(local.opts) === JSON.stringify(RP.opts), local);
    check("Eman: progress stays under key kk-eman-v2 on branch progress", gh.log.some(e => e.method === "GET" && e.path.endsWith("/progress.json") && e.ref === "progress"));
    const syncState = await (async () => { await tab(page, "settings"); return page.textContent("#syncState"); })();
    check("Eman: sync status is Arabic 'متزامن'", syncState === "متزامن", syncState);
    await grab(page, "settings-with-token");
    const htmlAttrs = await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir, document.title, document.querySelector("header h1").textContent, document.querySelector('meta[name="apple-mobile-web-app-title"]').content]);
    check("Eman: lang/dir/title/header/home-screen name unchanged", JSON.stringify(htmlAttrs) === JSON.stringify(["ar", "rtl", "كروت ألماني", "كلمات ألماني", "Deutsch"]), htmlAttrs);
    const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? r.scope : null; });
    check("Eman: service worker registered for /eman-deutsch/", sw === `${ORIGIN}/eman-deutsch/`, sw);

    // Learn: front, flip animation, back with tr + family chips + topic
    await tab(page, "learn");
    await grab(page, "learn-front");
    await page.screenshot({ path: SHOTS + "/light-1-learn-front.png" });
    const frontWord = await page.textContent("#card .word");
    await page.click("#card"); await sleep(700);
    const back = await page.evaluate(() => ({ flipped: document.querySelector("#card").classList.contains("flipped"), tr: !!document.querySelector("#card .tr"), cat: (document.querySelector("#card .cat") || {}).textContent }));
    check("Eman: card flips and back shows Arabic example translation (tr)", back.flipped && back.tr, back);
    const backSay = await page.evaluate(() => ({ row: !!document.querySelector('#card .wordrow .word + .say[data-say="w"]'), corner: document.querySelectorAll('#card > .say').length, ex: !!document.querySelector('#card .exrow .say[data-say="ex"]') }));
    check("Eman: flipped card shows the word with its speaker in one row, no corner speaker", backSay.row && backSay.corner === 0 && backSay.ex, backSay);
    check("Eman: card shows its Arabic topic", back.cat && /[؀-ۿ]/.test(back.cat), back.cat);
    await grab(page, "learn-back");
    await page.screenshot({ path: SHOTS + "/light-2-learn-back.png" });
    // Answer all queued cards -> done screen
    for (let i = 0; i < 40; i++) {
      if (await page.$(".done")) break;
      if (!(await page.$("#card.flipped"))) { await page.click("#card"); await sleep(450); }
      await page.click('[data-act="yes"]'); await sleep(80);
    }
    check("Eman: finishing the day shows done screen", !!(await page.$(".done")));
    await grab(page, "learn-done");

    // Family chips on a card back: show the list detail of "ausblick" instead (deterministic)
    await tab(page, "list");
    await page.screenshot({ path: SHOTS + "/light-3-list.png" });
    const topics = await page.$$eval(".topic h3 span:first-child", els => els.map(e => e.textContent));
    check("Eman: word list grouped into her 8 Arabic topics", topics.length === 8 && topics.every(t => /[؀-ۿ]/.test(t)), topics);
    const subRows = await page.$$eval(".list li.sub", els => els.length);
    check("Eman: family members are indented under their family (13 sub rows)", subRows === 13, subRows);
    await page.click('[data-act="open"][data-id="ausblick"]');
    const chips = await page.$$eval(".detail .famchip", els => els.map(e => e.textContent.trim()));
    check("Eman: 'Ausblick' detail shows its family chips (Blick, Einblick)", JSON.stringify(chips) === JSON.stringify(["der Blick", "der Einblick"]), chips);
    const listSay = await page.evaluate(() => ({ word: (document.querySelector('.detail .row2 [data-act="sayt"]') || {}).dataset, label: (document.querySelector('.detail .row2 [data-act="sayt"]') || {}).textContent, ex: !!document.querySelector(".detail .exrow .say[data-t]") }));
    check("Eman: word list detail has a speaker for the example and an Arabic listen button for the word", listSay.word && listSay.word.t === "der Ausblick" && listSay.label === "اسمعيها" && listSay.ex, listSay);
    await grab(page, "list-detail");
    await page.screenshot({ path: SHOTS + "/light-4-list-detail.png" });

    // Search: Arabic (with and without diacritics), German, the Arabic example translation, no hits
    const search = async q => { await page.fill("#q", q); await sleep(100); return page.$$eval(".list li:not([hidden]) .row", els => els.map(e => e.dataset.id)); };
    const s1 = await search("ضيق"), s2 = await search("Wohnung"), s3 = await search("الرف"), s4 = await search("xyzxyz");
    check("Eman: search Arabic meaning 'ضيق' finds eng", s1.includes("eng"), s1);
    check("Eman: search German 'Wohnung' finds several cards", s2.length >= 3, s2);
    check("Eman: search in Arabic example translation 'الرف' finds stabil", s3.includes("stabil"), s3);
    const nohits = await page.$eval("#nohits", e => !e.hidden && e.textContent);
    check("Eman: no-hits message is Arabic", nohits === "مفيش نتايج", nohits);
    await grab(page, "list-nohits");
    await search("");

    // Add a word with Gemini (key set now) and save it
    await tab(page, "settings");
    await page.fill("#gem", "fake-key");
    const gemToast = await toastOf(page, () => page.click('[data-act="savegem"]'));
    check("Eman: saving Gemini key shows Arabic toast", gemToast === "الـ Gemini key محفوظ", gemToast);
    await grab(page, "settings-gemini-set");
    await tab(page, "list");
    const phDir = await page.evaluate(() => getComputedStyle(document.querySelector("#nw")).direction);
    await page.fill("#nw", "umziehen");
    const typedDir = await page.evaluate(() => getComputedStyle(document.querySelector("#nw")).direction);
    const searchDir = await page.evaluate(() => getComputedStyle(document.querySelector("#q")).direction);
    check("Eman: empty inputs show Arabic placeholder right-to-left, typed German left-to-right", phDir === "rtl" && typedDir === "ltr" && searchDir === "rtl", { phDir, typedDir, searchDir });
    await page.fill("#nw", "");
    gem.card = { w: "umziehen", g: "x", hint: "zieht um, zog um, ist umgezogen", ar: "يعزّل / ينقل", ex: "Wir <b>ziehen</b> nächsten Monat <b>um</b>.", tr: "هنعزّل الشهر الجاي.", note: "", fam: "ziehen", cat: "السكن" };
    await page.fill("#nw", "umziehen"); await page.click('[data-act="gen"]');
    await page.waitForSelector(".preview", { timeout: 8000 });
    const req = gem.calls[gem.calls.length - 1].body;
    const prompt = req.contents[0].parts[0].text, schema = req.generationConfig.responseSchema;
    check("Eman: prompt asks for Egyptian Arabic and her rules", /Ägypterin/.test(prompt) && /tr: die Übersetzung des Beispielsatzes auf Ägyptisch-Arabisch/.test(prompt) && !/- def:/.test(prompt) && !/- perf:/.test(prompt), prompt);
    // families are listed only when their stem matches the new word (none for "umziehen"), topics always
    check("Eman: prompt lists her Arabic topics, families only with a matching stem", prompt.includes("السكن") && prompt.includes("كلمات وتعبيرات مهمة") && /Wortfamilien: keine\./.test(prompt) && !prompt.includes("räumen"), prompt.split("\n").filter(l => /Schon/.test(l)));
    check("Eman: schema = her fields (tr required, no def/perf)", JSON.stringify(Object.keys(schema.properties)) === JSON.stringify(["w", "g", "hint", "ar", "ex", "tr", "note", "fam", "cat"]) && JSON.stringify(schema.required) === JSON.stringify(["w", "g", "hint", "ar", "ex", "tr", "fam", "cat"]), schema);
    const formIds = await page.$$eval(".preview [id]", els => els.map(e => e.id));
    check("Eman: add form shows tr, hides def/perf", JSON.stringify(formIds) === JSON.stringify(["f_w", "f_g", "f_hint", "f_ar", "f_ex", "f_tr", "f_note", "f_cat", "f_fam"]), formIds);
    const trVal = await page.inputValue("#f_tr");
    check("Eman: tr from Gemini appears in the form", trVal === gem.card.tr, trVal);
    const dirs = await page.evaluate(() => ({ ar: getComputedStyle(document.querySelector("#f_ar")).direction, w: getComputedStyle(document.querySelector("#f_w")).direction, tr: getComputedStyle(document.querySelector("#f_tr")).direction }));
    check("Eman: Arabic fields right-to-left, German fields left-to-right", dirs.ar === "rtl" && dirs.tr === "rtl" && dirs.w === "ltr", dirs);
    await grab(page, "list-preview");
    await page.screenshot({ path: SHOTS + "/light-5-add-preview.png", fullPage: false });
    const savedToast = await toastOf(page, () => page.click('[data-act="savecard"]'));
    check("Eman: save shows Arabic toast", savedToast.startsWith("اتحفظت."), savedToast);
    const put = gh.log.filter(e => e.method === "PUT" && e.path.endsWith("/cards.js")).pop();
    const newSrc = unb64(put.body.content);
    const newLine = newSrc.split("\n").find(l => l.includes('"id":"umziehen"'));
    const saved = JSON.parse(newLine.trim());
    check("Eman: new card keeps tr, in her field order", JSON.stringify(Object.keys(saved)) === JSON.stringify(["id", "g", "w", "cat", "hint", "ar", "ex", "tr", "fam"]) && saved.tr === gem.card.tr, saved);
    check("Eman: existing 54 cards untouched by save", newSrc.startsWith(emanCards.slice(0, emanCards.lastIndexOf("\n];"))), newSrc.slice(-400));
    gh.store["main:cards.js"].content = newSrc;
    await grab(page, "list-after-save");

    // Arabic input that Gemini turns into a German word she already has -> "already in the list", no preview
    gem.card = { w: "Fläche", g: "die", hint: "die Fläche, -n", ar: "مساحة", ex: "Die <b>Fläche</b> ist groß.", tr: "المساحة كبيرة.", note: "", fam: "fläche", cat: "الوصف والمقاسات" };
    await page.fill("#nw", "مساحة"); await page.click('[data-act="gen"]');
    await page.waitForFunction(() => { const m = document.querySelector(".addmsg"); return m && m.textContent; }, null, { timeout: 8000 });
    const dupMsg = await page.textContent(".addmsg"), dupPreview = !!(await page.$(".preview"));
    check("Eman: Arabic input translated to an existing German word is reported as duplicate", dupMsg === "الكلمة دي موجودة في القايمة خلاص." && !dupPreview, { dupMsg, dupPreview });
    const lastPrompt = gem.calls[gem.calls.length - 1].body.contents[0].parts[0].text;
    check("Eman: prompt tells Gemini to translate Arabic/English input to German", lastPrompt.includes('Wort oder Ausdruck: "مساحة"') && lastPrompt.includes("Ist die Eingabe Arabisch oder Englisch"), lastPrompt.slice(0, 300));
    // Gemini unavailable -> waitlist
    gem.mode = "busy";
    await page.fill("#nw", "die Miete"); await page.click('[data-act="gen"]');
    await page.waitForSelector(".wait .chip", { timeout: 15000 });
    const msg = await page.textContent(".addmsg");
    check("Eman: Gemini down -> word goes to waitlist with Arabic message", msg.startsWith("Gemini مش بيرد دلوقتي."), msg);
    await grab(page, "list-waitlist");
    await page.screenshot({ path: SHOTS + "/light-6-waitlist.png" });
    const pend = JSON.parse(await page.evaluate(() => localStorage.getItem("kk-eman-v2"))).pending;
    check("Eman: waitlist entry stored in progress.pending", pend && pend["miete"] && pend["miete"].w === "die Miete", pend);
    await page.click('[data-act="unq"]');
    check("Eman: waitlist chip can be removed", !(await page.$(".wait .chip")));
    gem.mode = "ok";

    // Delete a card
    await page.click('[data-act="open"][data-id="umziehen"]');
    const delToast = await toastOf(page, () => page.click('[data-act="del"][data-id="umziehen"]'));
    const delPut = gh.log.filter(e => e.method === "PUT" && e.path.endsWith("/cards.js")).pop();
    const afterDel = unb64(delPut.body.content);
    check("Eman: delete asks in Arabic", page.dialogs.some(d => d === "متأكدة إنك عايزة تمسحي «umziehen» من القايمة؟"), page.dialogs);
    check("Eman: delete shows Arabic toast", delToast === "اتمسحت", delToast);
    check("Eman: after delete, cards.js equals her file byte for byte (tr/cat/fam kept)", afterDel === emanCards, afterDel.length + " vs " + emanCards.length);

    // Speaking practice: Gemini gives a situation, checks the answer, phrases can become cards
    gem.mode = "ok";
    gem.card = body => body.contents[0].parts[0].text.includes("Antwort der Schülerin")
      ? { correct: false, corrected: "Die Miete ist wirklich zu hoch.", natural: "Die Miete ist mir wirklich zu hoch.", tips: ["خدي بالك: Miete اسم مؤنث"], used: ["hoch"], chunks: ["mir wirklich zu hoch"], edits: [{ wrong: "sind", right: "ist", kind: "error" }, { wrong: "", right: "wirklich", kind: "style" }, { wrong: "", right: ".", kind: "error" }] }
      : { task: "قولي لصاحب الشقة إن الإيجار غالي عليكي.", starter: "Entschuldigung, aber" };
    await tab(page, "practice");
    await grab(page, "practice-start");
    await page.click('[data-act="prnew"]');
    await page.waitForSelector("#pa", { timeout: 8000 });
    const taskReq = gem.calls[gem.calls.length - 1].body, taskPrompt = taskReq.contents[0].parts[0].text;
    check("Eman: practice task asks Gemini in her style with two of her words", /Ägyptisch-Arabisch/.test(taskPrompt) && /Thema: [^\n]*[؀-ۿ]/.test(taskPrompt) && JSON.stringify(Object.keys(taskReq.generationConfig.responseSchema.properties)) === '["task","starter"]', taskPrompt.slice(0, 400));
    const prWords = await page.$$eval(".card.pr .famchip", els => els.length);
    check("Eman: practice shows the task in Arabic and two target words", prWords === 2 && (await page.textContent(".prtask")) === "قولي لصاحب الشقة إن الإيجار غالي عليكي.", prWords);
    await grab(page, "practice-task");
    await page.fill("#pa", "Die Miete sind zu hoch");
    const callsBefore = gem.calls.length;
    await page.goto(`${ORIGIN}/eman-deutsch/`); await sleep(1500);
    await tab(page, "practice");
    const kept = await page.evaluate(() => ({ task: document.querySelector(".prtask") && document.querySelector(".prtask").textContent, answer: document.querySelector("#pa") && document.querySelector("#pa").value, words: document.querySelectorAll(".card.pr .famchip").length }));
    check("Eman: an unfinished exercise survives closing the app (task, words, typed answer)", kept.task === "قولي لصاحب الشقة إن الإيجار غالي عليكي." && kept.answer === "Die Miete sind zu hoch" && kept.words === 2 && gem.calls.length === callsBefore, kept);
    await page.click('[data-act="prcheck"]');
    await page.waitForSelector(".prfb", { timeout: 8000 });
    const fbPrompt = gem.calls[gem.calls.length - 1].body.contents[0].parts[0].text;
    check("Eman: her answer is sent for feedback", fbPrompt.includes('"Die Miete sind zu hoch"') && fbPrompt.includes("قولي لصاحب الشقة"), fbPrompt.slice(0, 300));
    const fbView = await page.evaluate(() => ({ nat: document.querySelector(".prfb .ex").textContent, tips: document.querySelectorAll(".prtips li").length, chunks: document.querySelectorAll('.prfb [data-act="pradd"]').length, say: !!document.querySelector('.prfb .say[data-t]') }));
    const marks = await page.evaluate(() => ({ html: document.querySelector(".prfb .prde").innerHTML, dir: document.querySelector(".prfb .prde").dir }));
    const fbSchema = gem.calls[gem.calls.length - 1].body.generationConfig.responseSchema, fbText = gem.calls[gem.calls.length - 1].body.contents[0].parts[0].text;
    const legend = await page.evaluate(() => [...document.querySelectorAll(".prkey span")].map(e => e.className + ":" + e.textContent));
    check("Eman: errors and improvements are marked differently, with an Arabic legend", marks.html === 'Die Miete <del class="err">sind</del> <ins class="err">ist</ins> <ins class="sty">wirklich</ins> zu hoch<ins class="err">.</ins>' && marks.dir === "ltr" && JSON.stringify(legend) === JSON.stringify(["err:غلط", "sty:صياغة أحسن"]) && JSON.stringify(fbSchema.properties.edits.items.properties.kind.enum) === '["error","style"]' && /- edits: .*ihrer Antwort/.test(fbText), { marks, legend });
    check("Eman: feedback shows natural version with play button, tip and phrase", fbView.nat === "Die Miete ist mir wirklich zu hoch." && fbView.tips === 1 && fbView.chunks === 1 && fbView.say, fbView);
    await page.screenshot({ path: SHOTS + "/light-9-practice.png", fullPage: true });
    await grab(page, "practice-feedback");
    const ptext = body => body.contents[0].parts[0].text;
    gem.card = body => ptext(body).includes("Antwort der Schülerin")
      ? { correct: false, corrected: "Die Miete ist wirklich zu hoch.", natural: "Die Miete ist mir wirklich zu hoch.", tips: ["خدي بالك: Miete اسم مؤنث"], used: ["hoch"], chunks: ["mir wirklich zu hoch"], edits: [{ wrong: "sind", right: "ist", kind: "error" }, { wrong: "", right: "wirklich", kind: "style" }, { wrong: "", right: ".", kind: "error" }] }
      : ptext(body).includes("Grundstock") ? PH_STARTER : ptext(body).includes("Wendung oder Ausdruck") ? PH_ONE
      : { task: "قولي لصاحب الشقة إن الإيجار غالي عليكي.", starter: "Entschuldigung, aber" };
    const cardPuts = () => gh.log.filter(e => e.method === "PUT" && e.path.endsWith("/cards.js"));
    const putsBefore = cardPuts().length;
    await page.click('[data-act="pradd"]');
    const prPend = JSON.parse(await page.evaluate(() => localStorage.getItem("kk-eman-v2"))).pending;
    check("Eman: + puts the phrase on the waitlist as a phrase (k: p)", prPend && prPend["mir wirklich zu hoch"] && prPend["mir wirklich zu hoch"].k === "p", prPend);
    for (let i = 0; i < 40 && cardPuts().length === putsBefore; i++) await sleep(200);
    const phPut = cardPuts().pop(), phLine = phPut ? unb64(phPut.body.content).trim().split("\n").slice(-2, -1)[0] : "";
    const phPrompt = ptext(gem.calls.filter(c => ptext(c.body).includes("Wendung oder Ausdruck")).pop().body);
    check("Eman: phrase prompt is in her style (Egyptian Arabic, tr field, phrase groups)", /Ägypterin/.test(phPrompt) && /- tr:/.test(phPrompt) && /- cat: wofür/.test(phPrompt) && !/Wortfamilie/.test(phPrompt), phPrompt.slice(0, 300));
    check("Eman: the phrase is saved to cards.js as k: p with its source", phPut && phPut.body.message === "Neue Wendung: mir wirklich zu hoch" && phLine === ' ' + JSON.stringify({ id: "mirwirklichzuhoch", k: "p", g: "x", w: "mir wirklich zu hoch", cat: "إبداء الرأي", ar: PH_ONE.ar, ex: PH_ONE.ex, tr: PH_ONE.tr, src: "mir wirklich zu hoch" }), phLine);

    // Phrases list: separate from the word list, starter set from Gemini
    await tab(page, "list");
    const seg = await page.$$eval(".seg button", els => els.map(e => e.textContent.trim()));
    const wordRows = await page.$$eval(".list li", els => els.length);
    check("Eman: list has Arabic switch words/phrases, words list without the phrase", JSON.stringify(seg) === JSON.stringify(["الكلمات 54", "العبارات 1"]) && wordRows === 54 && !(await page.$('[data-id="mirwirklichzuhoch"]')), { seg, wordRows });
    await page.click('[data-act="lk"][data-k="p"]');
    const phView = await page.evaluate(() => ({ groups: [...document.querySelectorAll(".topic h3 span:first-child")].map(e => e.textContent), rows: document.querySelectorAll(".list li.ph").length, starter: !!document.querySelector('[data-act="pstart"]'), addPh: document.querySelector("#np").placeholder }));
    check("Eman: phrases view shows the phrase in its Arabic group and offers the starter set", JSON.stringify(phView.groups) === '["إبداء الرأي"]' && phView.rows === 1 && phView.starter && phView.addPh === "بالألماني أو العربي أو الإنجليزي", phView);
    await grab(page, "phrases-list");
    await page.screenshot({ path: SHOTS + "/light-10-phrases.png", fullPage: true });
    const starterToast = await toastOf(page, () => page.click('[data-act="pstart"]'));
    const stPut = cardPuts().pop(), stLines = unb64(stPut.body.content).trim().split("\n").filter(l => l.includes('"k":"p"'));
    check("Eman: starter set saved in one commit without duplicates", stPut.body.message === "3 neue Wendungen" && stLines.length === 4 && starterToast === "العبارات اتضافت: 3", { msg: stPut.body.message, n: stLines.length, starterToast });
    const phView2 = await page.evaluate(() => ({ groups: [...document.querySelectorAll(".topic h3 span:first-child")].map(e => e.textContent), rows: document.querySelectorAll(".list li.ph").length }));
    check("Eman: phrases grouped by what they are for", JSON.stringify(phView2.groups) === '["إبداء الرأي","كسب الوقت"]' && phView2.rows === 4, phView2);
    await page.click('[data-act="open"][data-id="also"]');
    await grab(page, "phrases-detail");
    const det = await page.evaluate(() => ({ tr: (document.querySelector(".detail .tr") || {}).textContent, note: (document.querySelector(".detail .note") || {}).textContent, say: !!document.querySelector(".detail .say[data-t]") }));
    check("Eman: phrase detail shows translation, usage note and play button", det.tr === "يعني، مش عارفة بالظبط." && det.note === "بتقوليها وإنتي بتفكري" && det.say, det);

    // Learn: new phrases come on top of new words (own daily limit), shown as phrase
    await tab(page, "learn");
    const learnPh = await page.evaluate(() => ({ ph: !!document.querySelector("#card.ph"), tag: [...document.querySelectorAll(".meta .new")].map(e => e.textContent) }));
    check("Eman: learning shows a new phrase card marked 'عبارة'", learnPh.ph && learnPh.tag.includes("عبارة"), learnPh);
    await grab(page, "learn-phrase");
    let phSeen = 0;
    for (let i = 0; i < 10 && (await page.$("#card")); i++) { if (await page.$("#card.ph")) phSeen++; await page.click("#card"); await sleep(450); await page.click('[data-act="yes"]'); await sleep(80); }
    const nd = JSON.parse(await page.evaluate(() => localStorage.getItem("kk-eman-v2"))).newDay;
    check("Eman: three new phrases per day, counted apart from words", phSeen === 3 && nd.p === 3, { phSeen, nd });
    // A phrase she knows (box 2) shows the meaning first and asks for the phrase
    const boxTwo = p => { p.cards.ichfindedass = { b: 2, due: 0, t: Date.now() + 1e9, n: 3, w: 0 }; p.updated = Date.now() + 1e9; return p; };
    gh.store["progress:progress.json"].content = JSON.stringify(boxTwo(JSON.parse(gh.store["progress:progress.json"].content)));
    await page.evaluate(() => { const p = JSON.parse(localStorage.getItem("kk-eman-v2")); p.cards.ichfindedass = { b: 2, due: 0, t: Date.now() + 1e9, n: 3, w: 0 }; p.updated = Date.now() + 1e9; localStorage.setItem("kk-eman-v2", JSON.stringify(p)); });
    await page.goto(`${ORIGIN}/eman-deutsch/`); await sleep(1500);
    // the phrases come from cards.js on GitHub (refreshed after the first sync)
    await page.waitForSelector("#card.ph", { timeout: 10000 }).catch(() => {});
    const known = await page.evaluate(() => ({ ph: !!document.querySelector("#card.ph"), ar: (document.querySelector("#card .ar-big") || {}).textContent, hint: (document.querySelector("#card .hint") || {}).textContent }));
    check("Eman: known phrase shows the meaning first and asks her to say it", known.ph && known.ar === "أنا شايفة إن…" && known.hint === "قوليها بالألماني", known);
    await grab(page, "learn-phrase-known");
    await tab(page, "settings");
    check("Eman: settings have new phrases per day in Arabic", (await page.textContent(".settings")).includes("عبارات جديدة في اليوم") && (await page.inputValue("#nppd")) === "3");

    // Quiz
    await tab(page, "quiz");
    await grab(page, "quiz-question");
    await page.click('.arts [data-g="der"]');
    await grab(page, "quiz-answered");
    await page.screenshot({ path: SHOTS + "/light-7-quiz.png" });

    // Settings pages, reset dialog text
    await tab(page, "settings");
    await page.screenshot({ path: SHOTS + "/light-8-settings.png", fullPage: true });
    await page.click('[data-act="delgem"]');
    await grab(page, "settings-gemini-empty");
    page.dialogs.length = 0;
    await page.evaluate(() => { window.confirm = m => { window.__lastConfirm = m; return false; }; });
    await page.click('[data-act="reset"]');
    const resetQ = await page.evaluate(() => window.__lastConfirm);
    check("Eman: reset asks in Arabic (kept text)", resetQ === "متأكدة إنك عايزة تمسحي التقدم كله؟", resetQ);
    await page.click('[data-act="deltoken"]');
    await grab(page, "settings-no-token");
    check("Eman: no page errors", !page.errors.length, page.errors);
    await ctx.close();
  }

  // Reminders UI when opened from the home screen (standalone emulated); push permission is not available headless
  {
    const gh = makeGitHub("amr-f-ramadan/eman-deutsch", { "main:cards.js": emanCards, "progress:progress.json": remoteProgress });
    const { ctx, page } = await newPage(browser, { storage: { "kk-eman-v2:token": "fake-token" }, standalone: true });
    await ctx.route("https://api.github.com/**", gh.handle);
    await page.goto(`${ORIGIN}/eman-deutsch/`); await sleep(1500);
    await tab(page, "settings");
    const remText = await page.textContent(".settings");
    check("Eman: reminder section in Arabic when opened from home screen", remText.includes("التذكير مش شغال") && remText.includes("شغّلي التذكير") && remText.includes("جربي على الجهاز ده"), remText.slice(0, 300));
    await grab(page, "settings-reminder-standalone");
    const remToast = await toastOf(page, () => page.click('[data-act="remon"]'));
    check("Eman: reminder error message is Arabic", /[؀-ۿ]/.test(remToast) && !/Erinnerung|Mitteilungen/.test(remToast), remToast);
    allUiText.push(["toast-reminder", remToast]);
    await ctx.close();
  }

  // A known card (box 2) is shown meaning first, to be said in German, with the 5 second bar
  {
    const prog = { v: 1, cards: { stabil: { b: 2, due: 1, t: 1, n: 2, w: 0 } }, art: {}, pending: {}, newDay: { d: new Date().toISOString().slice(0, 10), n: 99 }, opts: {}, updated: 1 };
    const { ctx, page } = await newPage(browser, { storage: { "kk-eman-v2": JSON.stringify(prog) } });
    await page.goto(`${ORIGIN}/eman-deutsch/`); await sleep(800);
    const front = await page.evaluate(() => ({ ar: (document.querySelector("#card .ar-big") || {}).textContent, timer: !!document.querySelector("#card .timer"), hint: (document.querySelector("#card .hint") || {}).textContent }));
    check("Eman: known card shows meaning first, asks for a German sentence, with timer", front.ar === "متين / ثابت" && front.timer && front.hint === "قوليها بالألماني في جملة كاملة", front);
    await grab(page, "learn-production");
    await page.screenshot({ path: SHOTS + "/light-10-production.png" });
    await ctx.close();
  }

  // Old key migration still works (wohnen-cards-v1 -> kk-eman-v2)
  {
    const { ctx, page } = await newPage(browser, { storage: { "wohnen-cards-v1": JSON.stringify({ known: ["stabil", "eng"] }) } });
    await page.goto(`${ORIGIN}/eman-deutsch/`); await sleep(800);
    await tab(page, "list");
    const lv = await page.$$eval('.row[data-id="stabil"] .lvl i.on, .row[data-id="eng"] .lvl i.on', els => els.length);
    check("Eman: migrate() from old key still applied (2 cards at level 2)", lv === 4, lv);
    await grab(page, "list-no-token");
    await ctx.close();
  }

  // Dark mode screenshots
  {
    const gh = makeGitHub("amr-f-ramadan/eman-deutsch", { "main:cards.js": emanCards, "progress:progress.json": remoteProgress });
    const { ctx, page } = await newPage(browser, { dark: true, storage: { "kk-eman-v2:token": "fake-token" } });
    await ctx.route("https://api.github.com/**", gh.handle);
    await page.goto(`${ORIGIN}/eman-deutsch/`); await sleep(1500);
    await page.screenshot({ path: SHOTS + "/dark-1-learn-front.png" });
    await page.click("#card"); await sleep(700);
    await page.screenshot({ path: SHOTS + "/dark-2-learn-back.png" });
    await tab(page, "list"); await page.click('[data-act="open"][data-id="einraeumen"]');
    await page.screenshot({ path: SHOTS + "/dark-3-list.png" });
    await tab(page, "settings"); await page.screenshot({ path: SHOTS + "/dark-4-settings.png" });
    check("Eman dark: no page errors", !page.errors.length, page.errors);
    await ctx.close();
  }

  // ===================== Long lists: topics collapse above 150 rows, search opens them, a tap toggles =====================
  {
    const { ctx, page } = await newPage(browser, {});
    await page.goto(`${ORIGIN}/eman-big/`); await sleep(1200);
    await tab(page, "list");
    const big = await page.evaluate(() => ({ total: document.querySelectorAll(".topic").length, coll: document.querySelectorAll(".topic.coll").length, closed: document.querySelectorAll(".topic.closed").length, firstOpen: !document.querySelector(".topic").classList.contains("closed"), rows: document.querySelectorAll(".list li").length }));
    check("Long list: all topics collapsible, all but the first closed", big.total > 2 && big.coll === big.total && big.closed === big.total - 1 && big.firstOpen && big.rows === 214, big);
    await page.fill("#q", "synthetisch159"); await sleep(120);
    const found = await page.evaluate(() => ({ open: [...document.querySelectorAll(".topic:not([hidden])")].map(s => s.classList.contains("closed")), hits: document.querySelectorAll(".list li:not([hidden])").length }));
    check("Long list: search shows the hit with its topic opened", found.hits === 1 && found.open.length === 1 && found.open[0] === false, found);
    await page.fill("#q", ""); await sleep(120);
    const back = await page.evaluate(() => document.querySelectorAll(".topic.closed").length);
    await page.click(".topic.closed h3");
    const toggled = await page.evaluate(() => document.querySelectorAll(".topic.closed").length);
    check("Long list: clearing the search closes the topics again, a tap opens one", back === big.total - 1 && toggled === big.total - 2, { back, toggled });
    await page.screenshot({ path: SHOTS + "/light-11-biglist.png", clip: { x: 0, y: 0, width: 390, height: 844 } });
    check("Long list: no page errors", !page.errors.length, page.errors);
    await ctx.close();
  }

  // ===================== Voice: Gemini speech, made once per text and kept on the device =====================
  {
    const gem = makeGemini();
    const { ctx, page } = await newPage(browser, { storage: { "kk-amr-v2:gemini": "fake-key" } });
    await ctx.route("https://generativelanguage.googleapis.com/**", gem.handle);
    await ctx.addInitScript(() => {
      window.__played = []; window.__said = [];
      HTMLMediaElement.prototype.play = function () { if (!this.src.startsWith("data:")) window.__played.push({ src: this.src, rate: this.playbackRate }); return Promise.resolve(); };
      speechSynthesis.speak = u => window.__said.push(u.text);
    });
    await page.goto(`${ORIGIN}/de-karteikarten/`); await sleep(1200);
    const word = (await page.textContent("#card .word")).replace(/\s+/g, " ").trim();
    gem.ttsDelay = 1200;
    await page.click("#card .say"); await sleep(500);
    const ring = await page.evaluate(() => ({ cls: document.querySelector("#card .say").classList.contains("loading"), busy: document.querySelector("#card .say").getAttribute("aria-busy"), ring: getComputedStyle(document.querySelector("#card .say"), "::after").animationName, inside: getComputedStyle(document.querySelector("#card .say"), "::after").top, icon: getComputedStyle(document.querySelector("#card .say svg")).animationName }));
    await page.screenshot({ path: SHOTS + "/voice-loading.png", clip: { x: 0, y: 100, width: 390, height: 500 } });
    await sleep(1300); gem.ttsDelay = 0;
    const ringGone = await page.evaluate(() => !document.querySelector(".loading"));
    check("Voice: a ring turns around the speaker while a new voice is made, and goes away", ring.cls && ring.busy === "true" && ring.ring === "spin" && ring.inside === "0px" && ring.icon === "pulse" && ringGone, { ring, ringGone });
    const first = await page.evaluate(() => ({ played: window.__played.length, src: (window.__played[0] || {}).src || "", said: window.__said.length }));
    const t1 = gem.tts[0];
    check("Voice: first tap asks the cheapest TTS model with only the text", gem.lists === 1 && gem.tts.length === 1 && /gemini-9-flash-lite-tts:generateContent/.test(t1.url) && JSON.stringify(t1.body.contents) === JSON.stringify([{ parts: [{ text: word }] }]), { lists: gem.lists, n: gem.tts.length, url: t1 && t1.url, contents: t1 && t1.body.contents, word });
    check("Voice: the Gemini audio is played, not the device voice", first.played === 1 && first.src.startsWith("blob:") && first.said === 0, first);
    await page.click("#card .say"); await sleep(400);
    await page.goto(`${ORIGIN}/de-karteikarten/`); await sleep(1200);
    await page.click("#card .say"); await sleep(150);
    const noRing = await page.evaluate(() => !document.querySelector(".loading"));
    await sleep(250);
    const again = await page.evaluate(() => window.__played.length);
    check("Voice: no ring when the voice is already on the phone", noRing);
    check("Voice: the same text again (also after reopening) comes from the device, no new Gemini call", gem.tts.length === 1 && gem.lists === 1 && again === 1, { tts: gem.tts.length, lists: gem.lists, again });
    // Article quiz: the word is spoken after answering; while its voice is made, the quiz waits
    await tab(page, "quiz");
    const freeOf = () => page.waitForFunction(() => !document.body.classList.contains("hold"), null, { timeout: 15000 });
    await freeOf(); // a hold from an earlier step would swallow the tap below
    const qWord = await page.textContent(".card.quiz .word");
    gem.ttsDelay = 1500;
    await page.click('.arts [data-g="der"]'); await page.waitForSelector(".arts .right", { timeout: 5000 }); await sleep(300);
    const qHold = await page.evaluate(() => ({ hold: document.body.classList.contains("hold"), ring: !!document.querySelector(".card.quiz .say.loading"), dim: getComputedStyle(document.querySelector('[data-act="nextq"]')).opacity }));
    await page.screenshot({ path: SHOTS + "/voice-quiz-hold.png", clip: { x: 0, y: 60, width: 390, height: 560 } });
    await page.click('[data-act="nextq"]'); await sleep(100);
    const qSame = (await page.textContent(".card.quiz .word")).includes(qWord.replace("___", "").trim());
    await freeOf(); gem.ttsDelay = 0;
    const qFree = await page.evaluate(() => !document.body.classList.contains("hold") && !document.querySelector(".loading"));
    await page.click('[data-act="nextq"]'); await sleep(200);
    const qNext = !!(await page.$(".arts .btn:not(.right):not(.wrong):not(.fade)"));
    check("Voice: quiz shows the ring and blocks 'next' until the word's voice is ready", qHold.hold && qHold.ring && Number(qHold.dim) < 0.6 && qSame && qFree && qNext, { qHold, qSame, qFree, qNext });
    await tab(page, "learn");
    gem.ttsMode = "busy";
    await page.click("#card"); await sleep(700);
    await page.click('#card .say[data-say="ex"]'); await sleep(1500);
    const fb = await page.evaluate(() => window.__said.slice());
    check("Voice: if Gemini fails, the device voice speaks instead", fb.length === 1 && fb[0].length > 10, fb);
    await tab(page, "settings"); await page.uncheck("#gvo"); await tab(page, "learn");
    const before = gem.tts.length;
    await page.click('#card .say[data-say="w"]'); await sleep(400);
    const off = await page.evaluate(() => window.__said.length);
    check("Voice: option off uses the device voice without asking Gemini", gem.tts.length === before && off === 2, { tts: gem.tts.length - before, off });
    check("Voice: no page errors", !page.errors.length, page.errors);
    await ctx.close();
  }

  // ===================== C. No German UI text anywhere (except German card content and tech names) =====================
  const amrApp = { window: {}, localStorage: { getItem: () => null } };
  for (const m of fs.readFileSync(AMR + "/index.html", "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], amrApp);
  const defValues = Object.values(amrApp.window.APP.t).filter(v => v.length > 3 && !/^(der|die|das)$/.test(v));
  const allowed = new Set();
  const addWords = s => String(s || "").replace(/<[^>]+>/g, " ").split(/[^A-Za-zÄÖÜäöüß]+/).forEach(w => w && allowed.add(w));
  loadCards(emanCards).concat([{ w: "umziehen", hint: "zieht um, zog um, ist umgezogen", ex: "Wir ziehen nächsten Monat um", fam: "ziehen" }, { w: "die Miete" }]).forEach(c => Object.values(c).forEach(addWords));
  ["der", "die", "das", "GitHub", "Gemini", "token", "key", "API", "Google", "AI", "Studio", "Contents", "Read", "and", "write", "Fine", "grained", "repo", "github", "pat", "AIza", "umziehen", "Miete", "ICE"].forEach(w => allowed.add(w));
  // German sentences in the practice mock are content, not UI
  ["Die Miete ist mir wirklich zu hoch", "Die Miete ist zu hoch", "Die Miete sind zu hoch", "Die Miete ist wirklich zu hoch", "Entschuldigung, aber"].forEach(addWords);
  [PH_ONE].concat(PH_STARTER).forEach(c => Object.values(c).forEach(addWords));
  const cardWords = loadCards(emanCards).map(c => c.w).sort((a, b) => b.length - a.length);
  const leaks = [];
  for (const [state, text] of allUiText) {
    // A German default text counts as a leak unless it is only one of her card words (e.g. the card "der Hinweis")
    const stripped = cardWords.reduce((t, w) => t.split(w).join(" "), text);
    for (const v of defValues) if (stripped.includes(v)) leaks.push([state, "DEF text: " + v]);
    const words = (text.match(/[A-Za-zÄÖÜäöüß]{2,}/g) || []).filter(w => !allowed.has(w));
    if (words.length) leaks.push([state, [...new Set(words)].join(", ")]);
  }
  check("No German UI text in any captured state (" + allUiText.length + " states)", !leaks.length, leaks);

  await browser.close(); srv.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("TEST CRASH", e); process.exit(2); });
