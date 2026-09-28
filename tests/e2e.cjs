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

// ---------- Gemini mock ----------
function makeGemini() {
  const g = { calls: [], mode: "ok", card: null };
  g.handle = async route => {
    const req = route.request();
    g.calls.push({ url: req.url(), body: JSON.parse(req.postData()) });
    if (g.mode === "busy") return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(g.card) }] } }] }) });
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
    check("Eman: prompt lists her Arabic topics and families", prompt.includes("السكن") && prompt.includes("كلمات وتعبيرات مهمة") && prompt.includes("räumen"), prompt.split("\n").filter(l => /Schon/.test(l)));
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

  // ===================== C. No German UI text anywhere (except German card content and tech names) =====================
  const amrApp = { window: {}, localStorage: { getItem: () => null } };
  for (const m of fs.readFileSync(AMR + "/index.html", "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], amrApp);
  const defValues = Object.values(amrApp.window.APP.t).filter(v => v.length > 3 && !/^(der|die|das)$/.test(v));
  const allowed = new Set();
  const addWords = s => String(s || "").replace(/<[^>]+>/g, " ").split(/[^A-Za-zÄÖÜäöüß]+/).forEach(w => w && allowed.add(w));
  loadCards(emanCards).concat([{ w: "umziehen", hint: "zieht um, zog um, ist umgezogen", ex: "Wir ziehen nächsten Monat um", fam: "ziehen" }, { w: "die Miete" }]).forEach(c => Object.values(c).forEach(addWords));
  ["der", "die", "das", "GitHub", "Gemini", "token", "key", "API", "Google", "AI", "Studio", "Contents", "Read", "and", "write", "Fine", "grained", "repo", "github", "pat", "AIza", "umziehen", "Miete", "ICE"].forEach(w => allowed.add(w));
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
