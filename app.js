/* Karteikarten-Engine: Leitner-Wiederholung, Artikel-Quiz, GitHub-Sync, Backup.
   Gemeinsam für mehrere Apps. Alles Persönliche (Texte, Kartenfelder, Gemini-Regeln, Erinnerungs-Schlüssel)
   kommt aus window.APP in index.html, die Karten aus window.CARDS. */
(function () {
  "use strict";
  const C = window.APP, CARDS = window.CARDS;
  const T = k => (C.t[k] !== undefined ? C.t[k] : k);
  const ART = { der: "der", die: "die", das: "das", pl: "die", x: "" };
  const DAY = 864e5, INT = [0, 1, 3, 7, 14, 30, 60];
  const $ = s => document.querySelector(s);
  const byId = Object.fromEntries(CARDS.map(c => [c.id, c]));
  /* Wendungen (Redemittel, Satzanfänge, Füllwörter) sind Karten mit k: "p"; eingeschaltet durch window.APP.phrases */
  const PH = C.phrases || null;
  const isP = c => c.k === "p";
  const WORDS = () => CARDS.filter(c => !isP(c));
  const nounList = () => CARDS.filter(c => !isP(c) && (c.g === "der" || c.g === "die" || c.g === "das"));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ---------- Fortschritt ---------- */
  const emptyP = () => ({ v: 1, cards: {}, art: {}, pending: {}, newDay: { d: "", n: 0 }, opts: {}, updated: 0 });
  function loadP() {
    try { const p = JSON.parse(localStorage.getItem(C.key) || "null"); if (p && p.v === 1) return Object.assign(emptyP(), p); } catch (e) {}
    const p = emptyP();
    if (C.migrate) try { C.migrate(p); } catch (e) {}
    return p;
  }
  let P = loadP(), dirty = false;
  function writeLocal() { try { localStorage.setItem(C.key, JSON.stringify(P)); } catch (e) {} }
  function changed() { P.updated = Date.now(); dirty = true; writeLocal(); scheduleSync(); }

  function merge(a, b) {
    const o = emptyP();
    for (const src of [a, b]) {
      for (const [id, s] of Object.entries(src.cards || {})) if (!o.cards[id] || s.t > o.cards[id].t) o.cards[id] = s;
      for (const [id, s] of Object.entries(src.art || {})) if (!o.art[id] || s.t > o.art[id].t) o.art[id] = s;
      for (const [k, s] of Object.entries(src.pending || {})) if (!o.pending[k] || s.t > o.pending[k].t) o.pending[k] = s;
    }
    const na = a.newDay || { d: "", n: 0 }, nb = b.newDay || { d: "", n: 0 };
    o.newDay = na.d === nb.d ? { d: na.d, n: Math.max(na.n, nb.n) } : (na.d > nb.d ? na : nb);
    if (na.d === nb.d && (na.p || nb.p)) o.newDay.p = Math.max(na.p || 0, nb.p || 0);
    o.opts = (a.updated || 0) >= (b.updated || 0) ? Object.assign({}, b.opts, a.opts) : Object.assign({}, a.opts, b.opts);
    o.updated = Math.max(a.updated || 0, b.updated || 0);
    return o;
  }
  const opt = (k, d) => (P.opts && P.opts[k] !== undefined ? P.opts[k] : d);
  function setOpt(k, v) { P.opts = P.opts || {}; P.opts[k] = v; changed(); }

  /* ---------- Wiederholung ---------- */
  function newToday(kind) { return P.newDay && P.newDay.d === today() ? (kind === "p" ? P.newDay.p || 0 : P.newDay.n) : 0; }
  function dueCards() {
    const now = Date.now();
    return CARDS.filter(c => P.cards[c.id] && P.cards[c.id].due <= now).sort((a, b) => P.cards[a.id].due - P.cards[b.id].due);
  }
  function freshCards() {
    const left = Math.max(0, opt("newPerDay", C.newPerDay || 10) - newToday());
    const words = CARDS.filter(c => !P.cards[c.id] && !isP(c)).slice(0, left);
    if (!PH) return words;
    const leftP = Math.max(0, opt("newPhrases", PH.perDay || 3) - newToday("p"));
    return words.concat(CARDS.filter(c => !P.cards[c.id] && isP(c)).slice(0, leftP));
  }
  let queue = [], cur = null, flipped = false;
  function buildQueue() { queue = shuffle(dueCards()).concat(freshCards()); }
  function answer(ok) {
    const c = cur, now = Date.now();
    let s = P.cards[c.id];
    if (!s) {
      s = P.cards[c.id] = { b: 0, due: now, t: now, n: 0, w: 0 };
      if (!P.newDay || P.newDay.d !== today()) P.newDay = { d: today(), n: 0 };
      if (isP(c)) P.newDay.p = (P.newDay.p || 0) + 1; else P.newDay.n++;
    }
    s.n++; s.t = now;
    if (ok) { s.b = Math.min(s.b + 1, INT.length - 1); s.due = startOfDay(now) + INT[s.b] * DAY; }
    else { s.w++; s.b = 0; s.due = now; queue.push(c); }
    changed();
    next();
  }
  function next() { cur = queue.shift() || null; flipped = false; render(); }
  // Neu gespeicherte Karten gleich lernen, soweit das Tageslimit reicht
  function refill() {
    const inQ = new Set(queue.map(c => c.id).concat(cur ? [cur.id] : []));
    freshCards().filter(c => !inQ.has(c.id)).forEach(c => queue.push(c));
    if (!cur) { cur = queue.shift() || null; flipped = false; }
  }
  let turning = false;
  const calm = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function flip() {
    if (flipped || turning) return;
    const el = $("#card");
    if (!el || !el.animate || calm()) { flipped = true; render(); return; }
    turning = true;
    el.animate([{ transform: "perspective(1000px) rotateY(0deg)" }, { transform: "perspective(1000px) rotateY(90deg)" }], { duration: 170, easing: "ease-in", fill: "forwards" }).onfinish = () => {
      flipped = true; render();
      const n = $("#card");
      if (n) n.animate([{ transform: "perspective(1000px) rotateY(-90deg)" }, { transform: "perspective(1000px) rotateY(0deg)" }], { duration: 220, easing: "ease-out" });
      turning = false;
    };
  }

  /* ---------- Artikel-Quiz ---------- */
  let nouns = nounList();
  let quiz = null;
  function pickQuiz() {
    if (!nouns.length) { quiz = null; return; }
    const w = nouns.map(c => { const a = P.art[c.id]; return 1 + (a ? a.w * 3 - a.ok * 0.5 : 2); }).map(x => Math.max(0.3, x));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (r > w[i]) { r -= w[i]; i++; }
    const c = nouns[Math.min(i, nouns.length - 1)];
    quiz = { c: quiz && quiz.c === c && nouns.length > 1 ? nouns[(i + 1) % nouns.length] : c, picked: null };
  }
  function quizAnswer(g) {
    if (quiz.picked) return;
    quiz.picked = g;
    const id = quiz.c.id, a = P.art[id] || { ok: 0, w: 0, t: 0 };
    if (g === quiz.c.g) a.ok++; else a.w++;
    a.t = Date.now(); P.art[id] = a; changed();
    render();
    speak(ART[quiz.c.g] + " " + quiz.c.w);
  }

  /* ---------- Aussprache ---------- */
  const hasTTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let deVoice = null;
  function pickVoice() { const v = speechSynthesis.getVoices(); deVoice = v.find(x => x.lang === "de-DE") || v.find(x => (x.lang || "").toLowerCase().startsWith("de")) || null; }
  if (hasTTS) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function plain(h) { const d = document.createElement("div"); d.innerHTML = h; return d.textContent.replace(/…/g, "").trim(); }
  function speak(text) {
    if (!hasTTS) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(plain(text));
      u.lang = "de-DE"; if (deVoice) u.voice = deVoice;
      u.rate = opt("slow", false) ? 0.7 : 0.95;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  const fullWord = c => (ART[c.g] ? ART[c.g] + " " : "") + c.w;

  /* ---------- GitHub-Sync ---------- */
  const TK = C.key + ":token";
  let token = "", sha = null, syncTimer = null, status = "local", busy = false;
  try { token = localStorage.getItem(TK) || ""; } catch (e) {}
  const API = "https://api.github.com/repos/" + C.repo + "/contents/progress.json";
  const b64enc = s => btoa(unescape(encodeURIComponent(s)));
  const b64dec = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
  function gh(method, body) {
    return fetch(API + (method === "GET" ? "?ref=progress&t=" + Date.now() : ""), {
      method, cache: "no-store", keepalive: method !== "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  async function pull() {
    const r = await gh("GET");
    if (r.status === 404) { sha = null; return null; }
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); sha = j.sha;
    return JSON.parse(b64dec(j.content));
  }
  async function makeBranch() {
    const base = "https://api.github.com/repos/" + C.repo + "/git/";
    const h = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
    try {
      const m = await fetch(base + "ref/heads/main", { headers: h, cache: "no-store" });
      if (!m.ok) return false;
      const r = await fetch(base + "refs", { method: "POST", headers: h, body: JSON.stringify({ ref: "refs/heads/progress", sha: (await m.json()).object.sha }) });
      return r.ok || r.status === 422;
    } catch (e) { return false; }
  }
  async function push() {
    const body = () => { const b = { message: "Fortschritt", content: b64enc(JSON.stringify(P)), branch: "progress" }; if (sha) b.sha = sha; return b; };
    let r = await gh("PUT", body());
    if ((r.status === 404 || r.status === 422) && !sha && await makeBranch()) r = await gh("PUT", body());
    if (r.status === 409 || r.status === 422) {
      const remote = await pull(); if (remote) { P = merge(P, remote); writeLocal(); }
      r = await gh("PUT", body());
    }
    if (!r.ok) throw new Error(r.status);
    sha = (await r.json()).content.sha; dirty = false;
  }
  async function sync(full) {
    if (!token || busy) return;
    busy = true; setStatus("syncing");
    try {
      if (full || sha === null) {
        const remote = await pull();
        if (remote) {
          const before = JSON.stringify(P.cards) + JSON.stringify(P.art);
          const m = merge(P, remote);
          if (JSON.stringify(m.cards) + JSON.stringify(m.art) + JSON.stringify(m.pending) !== JSON.stringify(remote.cards) + JSON.stringify(remote.art) + JSON.stringify(remote.pending || {})) dirty = true;
          P = m; writeLocal();
          if (before !== JSON.stringify(P.cards) + JSON.stringify(P.art) && !cur) { buildQueue(); cur = queue.shift() || null; }
        } else dirty = true;
      }
      if (dirty) await push();
      setStatus("ok");
    } catch (e) { const m = String(e.message); setStatus(m === "401" ? "badtoken" : m === "403" ? "noperm" : "error"); }
    busy = false; render();
  }
  function scheduleSync() { if (!token) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => sync(false), 15000); }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty && token) { clearTimeout(syncTimer); sync(false); }
    if (document.visibilityState === "visible" && token) sync(true);
  });
  function setStatus(s) { status = s; const el = $("#syncDot"); if (el) { el.dataset.s = s; el.title = T("st_" + s); } const st = $("#syncState"); if (st) st.textContent = T("st_" + s); }

  /* ---------- Backup ---------- */
  function exportFile() {
    const blob = new Blob([JSON.stringify(P, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = C.key + "-" + today() + ".json";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importFile(f) {
    const r = new FileReader();
    r.onload = () => {
      try { const p = JSON.parse(r.result); if (!p || p.v !== 1) throw 0; P = merge(P, p); changed(); flash(T("imported")); buildQueue(); next(); }
      catch (e) { flash(T("importFail")); }
    };
    r.readAsText(f);
  }

  /* ---------- Neue Wörter mit Gemini ---------- */
  const GK = C.key + ":gemini";
  let gkey = ""; try { gkey = localStorage.getItem(GK) || ""; } catch (e) {}
  let add = { word: "", busy: false, card: null, msg: "" };
  const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
  const famKey = c => c.fam || c.w.toLowerCase();
  const plainDe = t => String(t || "").toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
  const sameStem = (w, fam) => { const st = plainDe(fam).replace(/(end|ern|eln|en|n|e)$/, ""); return st.length >= 3 && plainDe(w).includes(st); };
  const topicOf = list => { const n = {}; list.forEach(x => { if (x.cat) n[x.cat] = (n[x.cat] || 0) + 1; }); let best = null; for (const x of list) if (x.cat && (!best || n[x.cat] > n[best])) best = x.cat; return best; };
  const relatives = c => (isP(c) ? [] : WORDS().filter(x => x !== c && famKey(x) === famKey(c)));
  const famList = () => [...new Set(WORDS().map(famKey))].join(", ");
  const topicList = () => [...new Set(WORDS().map(c => c.cat).filter(Boolean))].join(", ");
  /* Felder und Regeln für neue Karten kommen aus index.html (C.fields, C.rules mit intro und end). */
  const FIELDS = C.fields;
  const has = f => FIELDS.includes(f);
  const RULES = C.rules;
  const PROMPT = w => [RULES.intro, `Wort oder Ausdruck: "${w}"`, "Regeln:"]
    .concat(FIELDS.map(f => "- " + RULES[f].replace("{fams}", famList).replace("{topics}", topicList)), RULES.end).join("\n");
  const SCHEMA = { type: "OBJECT",
    properties: Object.fromEntries(FIELDS.map(f => [f, f === "g" ? { type: "STRING", enum: ["der", "die", "das", "pl", "x"] } : { type: "STRING" }])),
    required: FIELDS.filter(f => f !== "perf" && f !== "note") };
  async function gemini(prompt, schema, ok) {
    let last = "";
    for (const m of MODELS) {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": gkey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 } })
      });
      if (r.status === 404) { last = last || "404"; continue; }
      if (r.status >= 500) { last = last === "quota" ? "quota" : "busy"; await new Promise(res => setTimeout(res, 800)); continue; }
      if (r.status === 429) { last = "quota"; continue; }
      if (r.status === 400 || r.status === 403) throw new Error("key");
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const txt = (((j.candidates || [])[0] || {}).content || {}).parts;
      const out = JSON.parse(txt.map(p => p.text || "").join(""));
      if (!ok(out)) throw new Error("leer");
      return out;
    }
    throw new Error(last || "model");
  }
  const genCard = word => gemini(PROMPT(word), SCHEMA, c => c.w);
  /* Wendungen: Felder, Regeln und der Auftrag für den Grundstock kommen aus C.phrases */
  const PFIELDS = PH ? PH.fields : [];
  const phGroups = () => [...new Set(CARDS.filter(isP).map(c => c.cat).filter(Boolean))].join(", ");
  const pRules = () => PFIELDS.map(f => "- " + PH.rules[f].replace("{groups}", phGroups())).concat(PH.rules.end);
  const PSCHEMA = { type: "OBJECT", properties: Object.fromEntries(PFIELDS.map(f => [f, { type: "STRING" }])), required: PFIELDS.filter(f => f !== "note") };
  const goodP = p => p && p.w && p.ar && p.ex;
  const genPhrase = w => gemini([PH.rules.intro, `Wendung oder Ausdruck: "${w}"`, "Regeln:"].concat(pRules()).join("\n"), PSCHEMA, goodP);
  const genStarter = () => gemini([PH.starter, "Regeln für jede Wendung:"].concat(pRules()).join("\n"), { type: "ARRAY", items: PSCHEMA }, a => Array.isArray(a) && a.some(goodP));
  const pk = w => String(w || "").toLowerCase().replace(/[.,!?;:…]+/g, " ").replace(/\s+/g, " ").trim();
  const existsP = w => CARDS.some(c => pk(c.w) === pk(w));
  const slug = w => w.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "").slice(0, 30) || "wort";
  const exists = w => { const k = w.toLowerCase().replace(/^(der|die|das)\s+/, "").trim(); return CARDS.some(c => c.w.toLowerCase() === k); };
  /* Hängt neue Karten an cards.js im Branch main an; make(taken) baut die Einträge mit freien ids */
  async function putCards(make, message) {
    const url = "https://api.github.com/repos/" + C.repo + "/contents/cards.js";
    const h = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
    for (let tries = 0; tries < 2; tries++) {
      const g = await fetch(url + "?ref=main&t=" + Date.now(), { headers: h, cache: "no-store" });
      if (!g.ok) throw new Error(String(g.status));
      const j = await g.json(), src = b64dec(j.content);
      const list = make(id => src.includes('"id":"' + id + '"') || CARDS.some(c => c.id === id));
      const i = src.lastIndexOf("\n];");
      if (i < 0) throw new Error("format");
      const out = src.slice(0, i) + list.map(o => ",\n " + JSON.stringify(o)).join("") + src.slice(i);
      const p = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ message: message(list), content: b64enc(out), sha: j.sha, branch: "main" }) });
      if (p.status === 409 || p.status === 422) continue;
      if (!p.ok) throw new Error(String(p.status));
      return list;
    }
    throw new Error("409");
  }
  const freeId = (w, taken, used) => { let id = slug(w), n = 2; while (taken(id) || used.has(id)) id = slug(w) + n++; used.add(id); return id; };
  async function saveCard(card) {
    const list = await putCards(taken => {
      const id = freeId(card.w, taken, new Set());
      card.id = id;
      const o = { id, g: card.g, w: card.w, cat: (card.cat || "").trim() || T("newCat"), hint: card.hint || "", ar: card.ar };
      if (has("def")) o.def = card.def || "";
      o.ex = card.ex; if (card.tr) o.tr = card.tr;
      if (card.perf) o.perf = card.perf; if (card.note) o.note = card.note; if (card.src) o.src = card.src;
      const fk = (card.fam || "").trim().toLowerCase();
      if (fk && sameStem(o.w, fk) && (fk !== o.w.toLowerCase() || CARDS.some(x => famKey(x) === fk))) o.fam = fk;
      if (o.fam) { const kin = CARDS.filter(x => famKey(x) === o.fam && x.cat); if (kin.length) o.cat = topicOf(kin); }
      return [o];
    }, l => "Neues Wort: " + l[0].w);
    return list[0];
  }
  const savePhrases = items => putCards(taken => {
    const used = new Set();
    return items.map(p => {
      const o = { id: freeId(p.w, taken, used), k: "p", g: "x", w: p.w.trim(), cat: (p.cat || "").trim() || T("phNewCat"), ar: p.ar, ex: p.ex };
      if (p.tr) o.tr = p.tr; if (p.note) o.note = p.note; if (p.src) o.src = p.src;
      return o;
    });
  }, l => (l.length === 1 ? "Neue Wendung: " + l[0].w : l.length + " neue Wendungen"));
  async function removeCard(id) {
    const url = "https://api.github.com/repos/" + C.repo + "/contents/cards.js";
    const h = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
    for (let tries = 0; tries < 2; tries++) {
      const g = await fetch(url + "?ref=main&t=" + Date.now(), { headers: h, cache: "no-store" });
      if (!g.ok) throw new Error(String(g.status));
      const j = await g.json(), src = b64dec(j.content);
      const w = {}; new Function("window", src)(w);
      const list = (w.CARDS || []).filter(c => c.id !== id);
      const head = src.slice(0, src.indexOf("window.CARDS"));
      const out = head + "window.CARDS = [\n" + list.map(o => " " + JSON.stringify(o)).join(",\n") + "\n];\n";
      const p = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ message: "Wort gelöscht: " + id, content: b64enc(out), sha: j.sha, branch: "main" }) });
      if (p.status === 409 || p.status === 422) continue;
      if (!p.ok) throw new Error(String(p.status));
      return;
    }
    throw new Error("409");
  }
  async function doDelete(id) {
    const c = CARDS.find(x => x.id === id); if (!c) return;
    if (!token) { flash(T("needTok")); return; }
    if (!confirm(T("delQ").replace("{w}", fullWord(c)))) return;
    try {
      await removeCard(id);
      CARDS.splice(CARDS.indexOf(c), 1);
      nouns = nounList();
      queue = queue.filter(x => x.id !== id);
      if (quiz && quiz.c.id === id) quiz = null;
      delete P.cards[id]; delete P.art[id]; changed();
      if (cur && cur.id === id) { cur = queue.shift() || null; flipped = false; }
      listOpen = null; flash(T("deleted")); render();
    } catch (e) { flash(T("delFail") + " (" + e.message + ")"); }
  }
  function readForm() {
    const v = id => { const el = $("#" + id); return el ? el.value.trim() : ""; };
    return { w: v("f_w"), g: v("f_g") || "x", hint: v("f_hint"), perf: v("f_perf"), ar: v("f_ar"), def: v("f_def"), ex: v("f_ex"), tr: v("f_tr"), note: v("f_note"), fam: v("f_fam"), cat: v("f_cat") };
  }
  async function doGen() {
    const el = $("#nw"); if (el) add.word = el.value.trim();
    if (!add.word || add.busy) return;
    if (!gkey) { add.msg = T("needKey"); render(); return; }
    if (exists(add.word)) { add.msg = T("dup"); render(); return; }
    add.busy = "gen"; add.msg = ""; render();
    try {
      add.card = await genCard(add.word);
      // Eingabe auf Arabisch oder Englisch: erst jetzt steht das deutsche Wort fest
      if (exists(add.card.w)) { add.msg = T("dup"); add.card = null; add.word = ""; }
    }
    catch (e) {
      const m = e.message;
      if (m === "key") add.msg = T("keyBad");
      else { queueWord(add.word); add.msg = T("queued"); add.word = ""; }
    }
    add.busy = false; render();
  }
  async function doSave() {
    if (add.busy) return;
    const card = readForm(); add.card = card;
    if (!card.w || !card.ar || !card.ex) return;
    if (!token) { add.msg = T("needTok"); render(); return; }
    add.busy = "save"; render();
    try {
      const o = await saveCard(card);
      CARDS.push(o); nouns = nounList();
      add = { word: "", busy: false, card: null, msg: "" }; flash(T("saved"));
      if (!cur) { buildQueue(); cur = queue.shift() || null; }
    } catch (e) { add.busy = false; add.msg = T("genFail") + " (" + e.message + ")"; }
    add.busy = false; render();
  }
  /* ---------- Wendungen hinzufügen ---------- */
  let pad = { word: "", busy: false, card: null, msg: "" };
  const gemErr = e => (e.message === "key" ? T("keyBad") : null);
  async function doPGen() {
    const el = $("#np"); if (el) pad.word = el.value.trim();
    if (!pad.word || pad.busy) return;
    if (!gkey) { pad.msg = T("needKey"); render(); return; }
    if (existsP(pad.word)) { pad.msg = T("phDup"); render(); return; }
    pad.busy = "gen"; pad.msg = ""; render();
    try {
      pad.card = await genPhrase(pad.word);
      if (existsP(pad.card.w)) { pad.msg = T("phDup"); pad.card = null; pad.word = ""; }
    } catch (e) {
      if (gemErr(e)) pad.msg = gemErr(e);
      else { queueWord(pad.word, "p"); pad.msg = T("phQueued"); pad.word = ""; }
    }
    pad.busy = false; render();
  }
  async function doPSave() {
    if (pad.busy) return;
    const v = id => { const el = $("#" + id); return el ? el.value.trim() : ""; };
    const card = { w: v("pf_w"), ar: v("pf_ar"), ex: v("pf_ex"), tr: v("pf_tr"), note: v("pf_note"), cat: v("pf_cat") };
    pad.card = card;
    if (!card.w || !card.ar || !card.ex) return;
    if (!token) { pad.msg = T("needTok"); render(); return; }
    pad.busy = "save"; render();
    try {
      const [o] = await savePhrases([card]);
      CARDS.push(o); pad = { word: "", busy: false, card: null, msg: "" }; flash(T("saved")); refill();
    } catch (e) { pad.msg = T("genFail") + " (" + e.message + ")"; }
    pad.busy = false; render();
  }
  async function doStarter() {
    if (pad.busy) return;
    if (!gkey) { pad.msg = T("needKey"); render(); return; }
    if (!token) { pad.msg = T("needTok"); render(); return; }
    pad.busy = "starter"; pad.msg = ""; render();
    try {
      const seen = new Set(CARDS.filter(isP).map(c => pk(c.w)));
      const list = (await genStarter()).filter(p => goodP(p) && !seen.has(pk(p.w)) && seen.add(pk(p.w)));
      const saved = list.length ? await savePhrases(list) : [];
      saved.forEach(o => CARDS.push(o));
      flash(T("phStarterDone").replace("{n}", saved.length)); refill();
    } catch (e) { pad.msg = gemErr(e) || T("phStarterFail"); }
    pad.busy = false; render();
  }

  /* ---------- Warteliste ---------- */
  const pkey = w => w.toLowerCase().replace(/^(der|die|das)\s+/, "").trim();
  const isDone = k => CARDS.some(c => c.w.toLowerCase() === k || c.src === k);
  const waiting = kind => Object.entries(P.pending || {}).filter(([k, s]) => !s.done && !isDone(k) && (!kind || (s.k === "p") === (kind === "p")));
  function queueWord(w, kind) { P.pending = P.pending || {}; P.pending[pkey(w)] = kind ? { w: w, t: Date.now(), k: kind } : { w: w, t: Date.now() }; changed(); }
  function unqueue(k) { if (P.pending && P.pending[k]) { const s = P.pending[k]; P.pending[k] = Object.assign({ w: s.w, t: Date.now(), done: true }, s.k ? { k: s.k } : {}); changed(); } }
  let working = false;
  async function refreshCards() {
    if (!token) return;
    try {
      const r = await fetch("https://api.github.com/repos/" + C.repo + "/contents/cards.js?ref=main&t=" + Date.now(), { headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" }, cache: "no-store" });
      if (!r.ok) return;
      const w = {}; new Function("window", b64dec((await r.json()).content))(w);
      if (!Array.isArray(w.CARDS) || !w.CARDS.length) return;
      const known = new Set(CARDS.map(c => c.id)), fresh = w.CARDS.filter(c => !known.has(c.id));
      const ids = new Set(w.CARDS.map(c => c.id));
      for (let i = CARDS.length - 1; i >= 0; i--) if (!ids.has(CARDS[i].id)) CARDS.splice(i, 1);
      fresh.forEach(c => CARDS.push(c));
      if (fresh.length) { nouns = nounList(); if (!cur) { buildQueue(); cur = queue.shift() || null; } render(); }
    } catch (e) {}
  }
  async function workQueue() {
    if (working || !gkey || !token) return;
    working = true;
    try {
      await refreshCards();
      for (const [k, s] of waiting()) {
        if (s.k === "p") {
          if (!PH) continue;
          let ph;
          try { ph = await genPhrase(s.w); } catch (e) { break; }
          if (existsP(ph.w)) { unqueue(k); continue; }
          try {
            const [o] = await savePhrases([Object.assign(ph, { src: k })]);
            CARDS.push(o); unqueue(k); flash(T("autoAdded").replace("{w}", o.w)); refill();
          } catch (e) { break; }
          continue;
        }
        let card;
        try { card = await genCard(s.w); } catch (e) { break; }
        if (!card || !card.w || !card.ar || !card.ex) continue;
        card.src = k;
        if (exists(card.w)) { unqueue(k); continue; }
        try {
          const o = await saveCard(card);
          CARDS.push(o); nouns = nounList();
          unqueue(k); flash(T("autoAdded").replace("{w}", fullWord(o)));
          if (!cur) { buildQueue(); cur = queue.shift() || null; }
        } catch (e) { break; }
      }
    } finally { working = false; render(); }
  }
  setInterval(workQueue, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(workQueue, 3000); });
  function renderWait(kind) {
    const w = waiting(kind || "w");
    if (!w.length) return "";
    return `<div class="wait"><p class="waith">${T("waitH")}</p>${w.map(([k, s]) => `<span class="chip de">${esc(s.w)}<button data-act="unq" data-k="${esc(k)}" aria-label="${T("waitRm")}">×</button></span>`).join("")}</div>`;
  }
  function renderAdd() {
    const c = add.card, f = (id, val, big) => `<label class="fld">${T(id)}${big ? `<textarea id="${id}" rows="2" dir="auto">${esc(val || "")}</textarea>` : `<input id="${id}" dir="auto" value="${esc(val || "")}">`}</label>`;
    const sel = c ? `<label class="fld">${T("f_g")}<select id="f_g">${["der", "die", "das", "pl", "x"].map(g => `<option value="${g}" ${c.g === g ? "selected" : ""}>${g === "x" ? T("g_x") : g === "pl" ? T("g_pl") : g}</option>`).join("")}</select></label>` : "";
    return `<section class="add">
      <h2>${T("addH")}</h2>
      <div class="addrow"><input id="nw" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("addPh"))}" value="${esc(add.word)}">
      <button class="btn ok" data-act="gen" ${add.busy ? "disabled" : ""}>${add.busy === "gen" ? T("genBusy") : T("gen")}</button></div>
      ${add.msg ? `<p class="addmsg">${esc(add.msg)}</p>` : ""}
      ${renderWait()}
      ${c ? `<div class="preview">${f("f_w", c.w)}${sel}${f("f_hint", c.hint)}${has("perf") ? f("f_perf", c.perf) : ""}${f("f_ar", c.ar)}${has("def") ? f("f_def", c.def, 1) : ""}${f("f_ex", c.ex, 1)}${has("tr") ? f("f_tr", c.tr, 1) : ""}${f("f_note", c.note, 1)}${f("f_cat", c.cat)}${f("f_fam", c.fam)}
        <div class="row2"><button class="btn" data-act="discard">${T("discard")}</button><button class="btn" data-act="gen">${T("regen")}</button></div>
        <button class="btn ok wide" data-act="savecard" ${add.busy ? "disabled" : ""}>${add.busy === "save" ? T("saving") : T("saveCard")}</button></div>` : ""}
    </section>`;
  }

  /* ---------- Erinnerungen ---------- */
  const VAPID = C.vapid;
  const RK = C.key + ":remind";
  let rem = { on: false, hour: 19, min: 0 }; try { rem = Object.assign(rem, JSON.parse(localStorage.getItem(RK) || "{}")); } catch (e) {}
  const hhmm = (h, m) => String(h).padStart(2, "0") + ":" + String(m || 0).padStart(2, "0");
  let remBusy = false;
  const standalone = () => (navigator.standalone === true) || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  const u8 = b => { const p = "=".repeat((4 - b.length % 4) % 4), r = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, ch => ch.charCodeAt(0)); };
  async function putProgressFile(path, obj) {
    const url = "https://api.github.com/repos/" + C.repo + "/contents/" + path;
    const h = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
    for (let i = 0; i < 2; i++) {
      const g = await fetch(url + "?ref=progress&t=" + Date.now(), { headers: h, cache: "no-store" });
      const cur = g.ok ? (await g.json()).sha : null;
      const body = { message: "Erinnerung", content: b64enc(JSON.stringify(obj)), branch: "progress" }; if (cur) body.sha = cur;
      let r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify(body) });
      if ((r.status === 404 || r.status === 422) && !cur && await makeBranch()) r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify(body) });
      if (r.ok) return;
      if (r.status !== 409) throw new Error(String(r.status));
    }
    throw new Error("409");
  }
  async function remEnable(on) {
    if (remBusy) return;
    if (!token) { flash(T("remNeedTok")); return; }
    const hr = $("#remHour"); if (hr) { const v = parseInt(hr.value, 10); rem.hour = Math.floor(v / 60); rem.min = v % 60; }
    remBusy = true; render();
    try {
      let sub = null;
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("denied");
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(VAPID) });
      }
      await putProgressFile("push.json", { enabled: on, hour: rem.hour, minute: rem.min || 0, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin", sub: sub ? sub.toJSON() : null, updated: new Date().toISOString() });
      rem.on = on; try { localStorage.setItem(RK, JSON.stringify(rem)); } catch (x) {}
      flash(T("remDone"));
    } catch (e) { flash(e.message === "denied" ? T("remDenied") : T("remFail") + " (" + e.message + ")"); }
    remBusy = false; render();
  }
  async function remTest() {
    try {
      if (Notification.permission !== "granted" && await Notification.requestPermission() !== "granted") { flash(T("remDenied")); return; }
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(T("appName"), { body: T("remTestBody"), tag: "test" });
    } catch (e) { flash(T("remFail") + " (" + e.message + ")"); }
  }
  function renderRem() {
    const sel = rem.hour * 60 + (rem.min || 0);
    const hours = Array.from({ length: 96 }, (_, i) => `<option value="${i * 15}" ${i * 15 === sel ? "selected" : ""}>${hhmm(Math.floor(i / 4), (i % 4) * 15)}</option>`).join("");
    let body;
    if (!canPush() || !standalone()) body = `<p class="dim">${T("remNoApp")}</p>`;
    else body = `<p><span id="remDot" data-on="${rem.on}"></span> ${rem.on ? T("remActive").replace("{h}", hhmm(rem.hour, rem.min)) : T("remInactive")}</p>
      <label class="fld inline">${T("remHour")} <select id="remHour">${hours}</select></label>
      <div class="row2">${rem.on
        ? `<button class="btn" data-act="remon" ${remBusy ? "disabled" : ""}>${T("remSave")}</button><button class="btn" data-act="remoff" ${remBusy ? "disabled" : ""}>${T("remOff")}</button>`
        : `<button class="btn ok" data-act="remon" ${remBusy ? "disabled" : ""}>${T("remOn")}</button>`}</div>
      <button class="btn wide" data-act="remtest">${T("remTest")}</button>`;
    return `<h2>${T("remH")}</h2><p class="dim">${T("remHelp")}</p>${body}`;
  }
  function badge(n) { try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {} }

  /* ---------- Sprechen üben: Gemini gibt eine Situation, prüft die Antwort (Texte und Regeln aus C.practice) ---------- */
  let pr = { words: [], task: "", starter: "", answer: "", fb: null, busy: false, msg: "" };
  const PRK = C.key + ":practice";
  try { const o = JSON.parse(localStorage.getItem(PRK) || "null"); if (o && o.task && Array.isArray(o.words)) pr = Object.assign(pr, o); } catch (e) {}
  function prSave() {
    try { if (pr.task) localStorage.setItem(PRK, JSON.stringify({ words: pr.words, task: pr.task, starter: pr.starter, answer: pr.answer, fb: pr.fb })); else localStorage.removeItem(PRK); } catch (e) {}
  }
  const PR_TASK = { type: "OBJECT", properties: { task: { type: "STRING" }, starter: { type: "STRING" } }, required: ["task", "starter"] };
  const LIST = { type: "ARRAY", items: { type: "STRING" } };
  const PR_FB = { type: "OBJECT", properties: { correct: { type: "BOOLEAN" }, corrected: { type: "STRING" }, natural: { type: "STRING" }, tips: LIST, used: LIST, chunks: LIST },
    required: ["correct", "corrected", "natural", "tips", "used", "chunks"] };
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
  const pickOne = a => a[Math.floor(Math.random() * a.length)];
  function pickWords() {
    const all = WORDS(), seen = all.filter(c => P.cards[c.id]), known = seen.filter(c => P.cards[c.id].b >= 1);
    const pool = known.length >= 2 ? known : seen.length >= 2 ? seen : all;
    const a = pickOne(pool), same = pool.filter(c => c !== a && c.cat && c.cat === a.cat), rest = pool.filter(c => c !== a);
    return rest.length ? [a, pickOne(same.length ? same : rest)] : [a];
  }
  const wordList = ws => ws.map(fullWord).join(", ");
  const prError = e => (e.message === "key" ? T("keyBad") : T("prFail"));
  async function prNew() {
    if (pr.busy) return;
    if (!gkey) { pr.msg = T("needKey"); render(); return; }
    pr = { words: pickWords(), task: "", starter: "", answer: "", fb: null, busy: "task", msg: "" }; render();
    try { const t = await gemini(fill(C.practice.task, { words: wordList(pr.words), topic: pr.words[0].cat || "" }), PR_TASK, o => o.task); pr.task = t.task; pr.starter = t.starter || ""; }
    catch (e) { pr.msg = prError(e); }
    pr.busy = false; prSave(); render();
  }
  async function prCheck() {
    const el = $("#pa"); if (el) pr.answer = el.value.trim();
    if (!pr.answer || pr.busy) return;
    pr.busy = "check"; pr.msg = ""; render();
    try { pr.fb = await gemini(fill(C.practice.feedback, { words: wordList(pr.words), task: pr.task, answer: pr.answer }), PR_FB, o => o.natural); }
    catch (e) { pr.msg = prError(e); }
    pr.busy = false; prSave(); render();
  }
  function renderPractice() {
    const intro = `<p class="meta">${T("prIntro")}</p>`, msg = pr.msg ? `<p class="addmsg">${esc(pr.msg)}</p>` : "";
    if (!pr.task) return `${intro}<div class="card pr">${msg}<button class="btn ok wide" data-act="prnew" ${pr.busy ? "disabled" : ""}>${pr.busy ? T("prBusy") : T("prStart")}</button></div>`;
    const chip = c => `<button class="famchip de ${gClass(c)}" data-act="sayt" data-t="${esc(fullWord(c))}">${ART[c.g] ? `<span class="art">${ART[c.g]}</span> ` : ""}${esc(c.w)}</button>`;
    const f = pr.fb, used = f ? (f.used || []).map(norm) : [];
    const isUsed = c => used.some(u => u && (u.includes(norm(c.w)) || norm(c.w).includes(u)));
    return `${intro}<div class="card pr">
      <p class="prh">${T("prWords")}</p><div class="famrow">${pr.words.map(chip).join("")}</div>
      <p class="prtask" dir="auto">${esc(pr.task)}</p>
      ${pr.starter ? `<p class="hint de">${esc(pr.starter)} …</p>` : ""}
      <textarea id="pa" class="prin" rows="3" dir="auto" autocapitalize="sentences" placeholder="${esc(T("prPh"))}" ${f ? "readonly" : ""}>${esc(pr.answer)}</textarea>
      ${msg}
      ${f ? `<div class="prfb">
        <p class="prh">${f.correct ? T("prGood") : T("prCorrected")}</p><p class="de prde">${esc(f.corrected)}</p>
        <p class="prh">${T("prNatural")}</p><div class="exrow"><p class="ex de">${esc(f.natural)}</p>${speakBtn("", T("sayEx")).replace('data-say=""', `data-t="${esc(f.natural)}"`)}</div>
        ${(f.tips || []).length ? `<p class="prh">${T("prTips")}</p><ul class="prtips">${f.tips.map(t => `<li dir="auto">${esc(t)}</li>`).join("")}</ul>` : ""}
        <p class="prh">${T("prUsed")}</p><p class="prused de">${pr.words.map(c => `<span class="${isUsed(c) ? "yes" : "no"}">${isUsed(c) ? "✓" : "✗"} ${esc(fullWord(c))}</span>`).join(" ")}</p>
        ${(f.chunks || []).length ? `<p class="prh">${T("prChunks")}</p><div class="wait">${f.chunks.map(t => `<span class="chip de">${esc(t)}<button data-act="pradd" data-t="${esc(t)}" aria-label="${esc(T("prAdd"))}">+</button></span>`).join("")}</div>` : ""}
      </div>
      <button class="btn ok wide" data-act="prnew">${T("prNext")}</button>`
      : `<button class="btn ok wide" data-act="prcheck" ${pr.busy ? "disabled" : ""}>${pr.busy ? T("prBusy") : T("prCheck")}</button>`}
    </div>`;
  }

  /* ---------- Oberfläche ---------- */
  let mode = "learn", listOpen = null;
  function flash(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 2600); }
  const gClass = c => "g-" + (c.g || "x");
  const speakBtn = (what, label) => `<button class="say" data-say="${what}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>`;
  const wordHTML = c => `<span class="de word">${ART[c.g] ? `<span class="art">${ART[c.g]}</span> ` : ""}${esc(c.w)}</span>`;

  function famRow(c) {
    const r = relatives(c);
    if (!r.length) return "";
    return `<div class="famrow"><span class="famh">${T("famH")}</span>${r.map(x => `<button class="famchip de ${gClass(x)}" data-act="sayt" data-t="${esc(fullWord(x))}">${ART[x.g] ? `<span class="art">${ART[x.g]}</span> ` : ""}${esc(x.w)}</button>`).join("")}</div>`;
  }
  function renderLearn() {
    const due = dueCards().length, fresh = freshCards().length;
    if (!cur) {
      const tomorrow = CARDS.filter(c => P.cards[c.id] && P.cards[c.id].due <= startOfDay(Date.now()) + 2 * DAY).length;
      return `<div class="done"><p class="big">${T("doneTitle")}</p><p>${T("doneText").replace("{n}", tomorrow)}</p>
        <button class="btn" data-act="more">${T("moreNew")}</button></div>`;
    }
    const c = cur, s = P.cards[c.id], always = opt("arFirst", false);
    const arFirst = always || (opt("prodAuto", true) && !!s && s.b >= 2);
    const front = arFirst
      ? `<p class="ar-big">${esc(c.ar)}</p><p class="hint">${T(always ? "whatDe" : isP(c) ? "sayPh" : "sayDe")}</p>${calm() ? "" : '<div class="timer"></div>'}`
      : `${wordHTML(c)}${c.hint ? `<p class="hint de">${esc(c.hint)}</p>` : ""}`;
    const back = `
      ${arFirst ? wordHTML(c) + (c.hint ? `<p class="hint de">${esc(c.hint)}</p>` : "") : ""}
      <p class="ar" lang="ar" dir="rtl">${esc(c.ar)}</p>
      ${c.def ? `<p class="def de">${c.def}</p>` : ""}
      ${c.perf ? `<p class="perf de">${T("perfL")} <b>${esc(c.perf)}</b></p>` : ""}
      <div class="exrow"><p class="ex de">${c.ex}</p>${speakBtn("ex", T("sayEx"))}</div>
      ${c.tr ? `<p class="tr" lang="ar" dir="rtl">${esc(c.tr)}</p>` : ""}
      ${c.note ? `<p class="note">${c.note}</p>` : ""}
      ${famRow(c)}`;
    return `
      <p class="meta">${T("left").replace("{n}", queue.length + 1)}${isP(c) ? ` <span class="new">${T("phTag")}</span>` : ""}${s ? "" : ` <span class="new">${T("newCard")}</span>`}</p>
      <div class="card ${gClass(c)}${isP(c) ? " ph" : ""} ${flipped ? "flipped" : ""}" id="card" data-act="flip" role="button" tabindex="0" aria-label="${T("flip")}">
        ${c.cat ? `<p class="cat">${esc(c.cat)}</p>` : ""}
        <div class="face">${flipped ? back : front}</div>
        ${speakBtn("w", T("sayWord"))}
      </div>
      ${flipped
        ? `<div class="rate"><button class="btn again" data-act="no">${T("again")}</button><button class="btn ok" data-act="yes">${T("good")}</button></div>`
        : `<button class="btn wide" data-act="flip">${T("show")}</button>`}
      <p class="meta dim">${T("todayStat").replace("{d}", due).replace("{f}", fresh)}</p>`;
  }

  function renderQuiz() {
    if (!quiz) pickQuiz();
    if (!quiz) return `<div class="done"><p>${T("noNouns")}</p></div>`;
    const c = quiz.c, a = P.art[c.id];
    const opts = ["der", "die", "das"].map(g => {
      let cls = "btn art-" + g;
      if (quiz.picked) { if (g === c.g) cls += " right"; else if (g === quiz.picked) cls += " wrong"; else cls += " fade"; }
      return `<button class="${cls}" data-act="art" data-g="${g}">${g}</button>`;
    }).join("");
    return `
      <p class="meta">${T("artQ")}</p>
      <div class="card quiz ${quiz.picked ? gClass(c) : ""}">
        <div class="face"><span class="de word">${quiz.picked ? `<span class="art">${ART[c.g]}</span> ` : "<span class=\"blank\">___</span> "}${esc(c.w)}</span>
        ${quiz.picked ? `<p class="ar" lang="ar" dir="rtl">${esc(c.ar)}</p>` : ""}</div>
      </div>
      <div class="arts">${opts}</div>
      ${quiz.picked ? `<button class="btn wide" data-act="nextq">${T("next")}</button>` : ""}
      <p class="meta dim">${a ? T("artStat").replace("{ok}", a.ok).replace("{w}", a.w) : ""}</p>`;
  }

  function grouped() {
    const out = [], seen = new Set(), all = WORDS();
    all.forEach(c => {
      if (seen.has(c.id)) return;
      const fam = all.filter(x => famKey(x) === famKey(c));
      fam.forEach((x, i) => { seen.add(x.id); out.push([x, i > 0, fam.length > 1]); });
    });
    return out;
  }
  let query = "";
  const norm = t => String(t || "").toLowerCase().replace(/<[^>]+>/g, "").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/[\u064B-\u0652]/g, "");
  const hay = c => norm([fullWord(c), c.ar, c.hint, c.def, c.ex, c.tr, c.cat, c.fam, c.perf].join(" "));
  function applyFilter() {
    const q = norm(query).trim();
    let any = false;
    document.querySelectorAll(".topic").forEach(sec => {
      let n = 0;
      sec.querySelectorAll("li").forEach(li => { const hit = !q || li.dataset.s.includes(q); li.hidden = !hit; if (hit) n++; });
      sec.hidden = !n; if (n) any = true;
      const cnt = sec.querySelector(".tcount"); if (cnt) cnt.textContent = n;
    });
    const nh = $("#nohits"); if (nh) nh.hidden = any;
  }
  let listKind = "w";
  const dotsOf = c => { const s = P.cards[c.id], b = s ? s.b : -1; return `<span class="lvl" aria-label="${T("level")} ${Math.max(b, 0)}">${Array.from({ length: INT.length - 1 }, (_, i) => `<i class="${i < b ? "on" : ""}"></i>`).join("")}</span>`; };
  const searchBox = () => `<input id="q" class="search" type="search" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("searchPh"))}" value="${esc(query)}">`;
  function renderSeg() {
    if (!PH) return "";
    const b = (k, label, n) => `<button data-act="lk" data-k="${k}" aria-pressed="${listKind === k}">${label} <span class="segn">${n}</span></button>`;
    return `<div class="seg">${b("w", T("segW"), WORDS().length)}${b("p", T("segP"), CARDS.filter(isP).length)}</div>`;
  }
  function renderPAdd() {
    const c = pad.card, f = (id, label, val, big) => `<label class="fld">${T(label)}${big ? `<textarea id="${id}" rows="2" dir="auto">${esc(val || "")}</textarea>` : `<input id="${id}" dir="auto" value="${esc(val || "")}">`}</label>`;
    return `<section class="add">
      <h2>${T("phAddH")}</h2>
      <div class="addrow"><input id="np" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("phAddPh"))}" value="${esc(pad.word)}">
      <button class="btn ok" data-act="pgen" ${pad.busy ? "disabled" : ""}>${pad.busy === "gen" ? T("genBusy") : T("gen")}</button></div>
      ${pad.msg ? `<p class="addmsg">${esc(pad.msg)}</p>` : ""}
      ${renderWait("p")}
      ${c ? `<div class="preview">${f("pf_w", "phF_w", c.w)}${f("pf_ar", "f_ar", c.ar)}${f("pf_ex", "f_ex", c.ex, 1)}${PFIELDS.includes("tr") ? f("pf_tr", "f_tr", c.tr, 1) : ""}${f("pf_note", "f_note", c.note, 1)}${f("pf_cat", "phF_cat", c.cat)}
        <div class="row2"><button class="btn" data-act="pdiscard">${T("discard")}</button><button class="btn" data-act="pgen">${T("regen")}</button></div>
        <button class="btn ok wide" data-act="psave" ${pad.busy ? "disabled" : ""}>${pad.busy === "save" ? T("saving") : T("saveCard")}</button></div>` : ""}
      ${CARDS.filter(isP).length < 10 ? `<div class="starter"><p class="dim">${T("phStarterHelp")}</p><button class="btn wide" data-act="pstart" ${pad.busy ? "disabled" : ""}>${pad.busy === "starter" ? T("phStarterBusy") : T("phStarter")}</button></div>` : ""}
    </section>`;
  }
  function renderPhrases() {
    const all = CARDS.filter(isP), groups = new Map();
    all.forEach(c => {
      const g = c.cat || T("phNewCat");
      if (!groups.has(g)) groups.set(g, []);
      const open = listOpen === c.id;
      groups.get(g).push(`<li class="${gClass(c)} ph" data-s="${esc(hay(c))}"><button class="row" data-act="open" data-id="${c.id}">
        <span class="de word">${esc(c.w)}</span>${dotsOf(c)}</button>
        ${open ? `<div class="detail"><p class="ar" lang="ar" dir="rtl">${esc(c.ar)}</p><div class="exrow"><p class="ex de">${c.ex}</p><button class="say" data-t="${esc(plain(c.ex))}" aria-label="${esc(T("sayEx"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button></div>${c.tr ? `<p class="tr" lang="ar" dir="rtl">${esc(c.tr)}</p>` : ""}${c.note ? `<p class="note">${c.note}</p>` : ""}<div class="row2"><button class="btn" data-act="sayt" data-t="${esc(c.w.replace(/…/g, ""))}">${T("phSay")}</button><button class="btn again" data-act="del" data-id="${c.id}">${T("delCard")}</button></div></div>` : ""}</li>`);
    });
    const secs = [...groups.entries()].map(([t, rows]) => `<section class="topic"><h3><span>${esc(t)}</span><span class="tcount">${rows.length}</span></h3><ul class="list">${rows.join("")}</ul></section>`).join("");
    const learned = all.filter(c => P.cards[c.id] && P.cards[c.id].b >= 3).length;
    return `${renderSeg()}${renderPAdd()}${all.length ? searchBox() + `<p class="meta">${T("phStat").replace("{a}", learned).replace("{t}", all.length)}</p>` : ""}${secs}<p id="nohits" class="meta dim" hidden>${T("noHits")}</p>`;
  }
  function renderList() {
    if (PH && listKind === "p") return renderPhrases();
    const topics = new Map();
    let famTopic = null;
    grouped().forEach(([c, sub, inFam]) => {
      if (!sub) famTopic = topicOf(WORDS().filter(x => famKey(x) === famKey(c))) || T("newCat");
      if (!topics.has(famTopic)) topics.set(famTopic, []);
      const s = P.cards[c.id], b = s ? s.b : -1;
      const dots = Array.from({ length: INT.length - 1 }, (_, i) => `<i class="${i < b ? "on" : ""}"></i>`).join("");
      const open = listOpen === c.id;
      topics.get(famTopic).push(`<li class="${gClass(c)}${sub ? " sub" : ""}${inFam ? " infam" : ""}" data-s="${esc(hay(c))}"><button class="row" data-act="open" data-id="${c.id}">
        ${wordHTML(c)}<span class="lvl" aria-label="${T("level")} ${Math.max(b, 0)}">${dots}</span></button>
        ${open ? `<div class="detail"><p class="ar" lang="ar" dir="rtl">${esc(c.ar)}</p>${c.perf ? `<p class="perf de">${T("perfL")} <b>${esc(c.perf)}</b></p>` : ""}<p class="ex de">${c.ex}</p>${c.tr ? `<p class="tr" lang="ar" dir="rtl">${esc(c.tr)}</p>` : ""}${famRow(c)}<button class="btn again" data-act="del" data-id="${c.id}">${T("delCard")}</button></div>` : ""}</li>`);
    });
    const secs = [...topics.entries()].map(([t, rows]) => `<section class="topic"><h3><span>${esc(t)}</span><span class="tcount">${rows.length}</span></h3><ul class="list">${rows.join("")}</ul></section>`).join("");
    const words = WORDS(), learned = words.filter(c => P.cards[c.id] && P.cards[c.id].b >= 3).length;
    return `${renderSeg()}${renderAdd()}${searchBox()}
      <p class="meta">${T("listStat").replace("{a}", learned).replace("{t}", words.length)}</p>${secs}<p id="nohits" class="meta dim" hidden>${T("noHits")}</p>`;
  }

  function renderSettings() {
    return `<div class="settings">
      <h2>${T("syncH")}</h2>
      <p class="dim">${T("syncHelp")}</p>
      <p><span id="syncDot" data-s="${status}"></span> <span id="syncState">${T("st_" + status)}</span></p>
      ${token
        ? `<div class="row2"><button class="btn" data-act="syncnow">${T("syncNow")}</button><button class="btn" data-act="deltoken">${T("delToken")}</button></div>`
        : `<label class="fld">${T("tokenLabel")}<input id="tok" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
           <button class="btn ok" data-act="savetoken">${T("saveToken")}</button>`}
      ${renderRem()}
      <h2>${T("gemH")}</h2>
      <p class="dim">${T("gemHelp")}</p>
      ${gkey
        ? `<p><span id="gemDot"></span> ${T("gemSet")}</p><button class="btn" data-act="delgem">${T("gemDel")}</button>`
        : `<label class="fld">${T("gemLabel")}<input id="gem" type="password" autocomplete="off" spellcheck="false" placeholder="AIza…"></label>
           <button class="btn ok" data-act="savegem">${T("gemSave")}</button>`}
      <h2>${T("backupH")}</h2>
      <div class="row2"><button class="btn" data-act="export">${T("export")}</button>
      <label class="btn filebtn">${T("import")}<input id="imp" type="file" accept="application/json,.json"></label></div>
      <h2>${T("optsH")}</h2>
      <label class="fld inline">${T("newPerDay")} <input id="npd" type="number" min="0" max="50" value="${opt("newPerDay", C.newPerDay || 10)}"></label>
      ${PH ? `<label class="fld inline">${T("newPhrases")} <input id="nppd" type="number" min="0" max="20" value="${opt("newPhrases", PH.perDay || 3)}"></label>` : ""}
      <label class="chk"><input id="pda" type="checkbox" ${opt("prodAuto", true) ? "checked" : ""}> ${T("prodAuto")}</label>
      <label class="chk"><input id="arf" type="checkbox" ${opt("arFirst", false) ? "checked" : ""}> ${T("arFirst")}</label>
      <label class="chk"><input id="slw" type="checkbox" ${opt("slow", false) ? "checked" : ""}> ${T("slow")}</label>
      <h2>${T("resetH")}</h2>
      <button class="btn again" data-act="reset">${T("reset")}</button>
    </div>`;
  }

  function render() {
    document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-current", b.dataset.mode === mode ? "page" : "false"));
    const dueN = dueCards().length + freshCards().length;
    const bd = $("#badge"); if (bd) { bd.textContent = dueN; bd.hidden = !dueN; }
    badge(dueN);
    $("#main").innerHTML = mode === "learn" ? renderLearn() : mode === "quiz" ? renderQuiz() : mode === "list" ? renderList() : mode === "practice" ? renderPractice() : renderSettings();
    if (mode === "list" && query) applyFilter();
    setStatus(status);
  }

  document.addEventListener("click", e => {
    const nb = e.target.closest("nav button");
    if (nb) { mode = nb.dataset.mode; if (mode === "quiz" && !quiz) pickQuiz(); render(); window.scrollTo(0, 0); return; }
    const say = e.target.closest(".say");
    if (say && say.dataset.t) { e.stopPropagation(); speak(say.dataset.t); return; }
    if (say) { e.stopPropagation(); const c = mode === "quiz" ? quiz && quiz.c : cur; if (c) speak(say.dataset.say === "ex" ? c.ex : fullWord(c)); return; }
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act;
    if (act === "flip") flip();
    else if (act === "yes") answer(true);
    else if (act === "no") answer(false);
    else if (act === "more") { const p = newToday("p"); P.newDay = { d: today(), n: Math.max(0, newToday() - opt("newPerDay", C.newPerDay || 10)) }; if (p) P.newDay.p = p; changed(); buildQueue(); next(); }
    else if (act === "art") quizAnswer(el.dataset.g);
    else if (act === "nextq") { pickQuiz(); render(); }
    else if (act === "open") { listOpen = listOpen === el.dataset.id ? null : el.dataset.id; render(); }
    else if (act === "savetoken") {
      const v = ($("#tok").value || "").trim(); if (!v) return;
      token = v; try { localStorage.setItem(TK, v); } catch (x) {}
      sync(true).then(() => flash(status === "ok" ? T("tokenOk") : T("st_" + status)));
    }
    else if (act === "deltoken") { token = ""; sha = null; try { localStorage.removeItem(TK); } catch (x) {} setStatus("local"); render(); }
    else if (act === "syncnow") sync(true).then(() => flash(T("st_" + status)));
    else if (act === "export") exportFile();
    else if (act === "gen") { const w = $("#nw"); if (w && add.card && !w.value.trim()) w.value = add.word; doGen(); }
    else if (act === "savecard") doSave();
    else if (act === "del") doDelete(el.dataset.id);
    else if (act === "unq") { unqueue(el.dataset.k); render(); }
    else if (act === "sayt") { e.stopPropagation(); speak(el.dataset.t); }
    else if (act === "remon") remEnable(true);
    else if (act === "remoff") remEnable(false);
    else if (act === "remtest") remTest();
    else if (act === "discard") { add = { word: "", busy: false, card: null, msg: "" }; render(); }
    else if (act === "savegem") { const v = ($("#gem").value || "").trim(); if (!v) return; gkey = v; try { localStorage.setItem(GK, v); } catch (x) {} flash(T("gemSet")); render(); }
    else if (act === "delgem") { gkey = ""; try { localStorage.removeItem(GK); } catch (x) {} render(); }
    else if (act === "prnew") prNew();
    else if (act === "prcheck") prCheck();
    else if (act === "pradd") { queueWord(el.dataset.t, PH ? "p" : undefined); flash(T("prAdded")); el.disabled = true; setTimeout(workQueue, 500); }
    else if (act === "lk") { listKind = el.dataset.k; listOpen = null; query = ""; render(); }
    else if (act === "pgen") { const w = $("#np"); if (w && pad.card && !w.value.trim()) w.value = pad.word; doPGen(); }
    else if (act === "psave") doPSave();
    else if (act === "pdiscard") { pad = { word: "", busy: false, card: null, msg: "" }; render(); }
    else if (act === "pstart") doStarter();
    else if (act === "reset") { if (confirm(T("resetQ"))) { P = Object.assign(emptyP(), { opts: P.opts }); changed(); buildQueue(); next(); } }
  });
  document.addEventListener("change", e => {
    if (e.target.id === "imp" && e.target.files[0]) importFile(e.target.files[0]);
    else if (e.target.id === "npd") { setOpt("newPerDay", Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0))); if (!cur) { buildQueue(); cur = queue.shift() || null; } }
    else if (e.target.id === "arf") setOpt("arFirst", e.target.checked);
    else if (e.target.id === "slw") setOpt("slow", e.target.checked);
    else if (e.target.id === "pda") setOpt("prodAuto", e.target.checked);
    else if (e.target.id === "nppd") { setOpt("newPhrases", Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0))); if (!cur) { buildQueue(); cur = queue.shift() || null; } }
  });
  document.addEventListener("input", e => { if (e.target.id === "q") { query = e.target.value; applyFilter(); } else if (e.target.id === "pa") { pr.answer = e.target.value; prSave(); } });
  document.addEventListener("keydown", e => {
    if (e.target.id === "nw" && e.key === "Enter") { e.preventDefault(); doGen(); return; }
    if (e.target.id === "np" && e.key === "Enter") { e.preventDefault(); doPGen(); return; }
    if (mode !== "learn" || !cur || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flip(); }
    else if (flipped && (e.key === "1" || e.key === "ArrowLeft")) answer(false);
    else if (flipped && (e.key === "2" || e.key === "ArrowRight")) answer(true);
  });

  /* Kein Zoomen: Pinch, Doppeltippen und Auto-Zoom in Eingabefeldern verhindern */
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  ["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener("touchmove", e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });

  buildQueue(); cur = queue.shift() || null;
  setStatus(token ? "syncing" : "local");
  render();
  if (token) sync(true).then(() => setTimeout(workQueue, 1500));
})();
