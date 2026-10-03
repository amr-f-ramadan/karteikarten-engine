// Wortschatz pflegen: neue Karten und Wendungen mit Gemini, Speichern in cards.js, Löschen, Warteliste.
import { fullWord, pkey, isP } from "./core/text.js";
import { cardPrompt, cardSchema, phrasePrompt, phraseSchema, starterPrompt, starterSchema, goodPhrase, anyPrompt, anySchema, goodAny, fillPrompt, fillSchema } from "./core/prompt.js";
import { appendCards, serializeCards, parseCards, headOf } from "./core/cardsfile.js";
import { freeId, shapeCard, withFields, mergeFamily, cleanForms } from "./core/newcard.js";
import { hold } from "./ui/dom.js";

export function createVocab(ctx) {
  const { C, T, S, store, github, gemini } = ctx, PH = C.phrases || null;
  /* Felder und Regeln für neue Karten kommen aus index.html (C.fields, C.rules mit intro und end) */
  const FIELDS = C.fields, has = f => FIELDS.includes(f), SCHEMA = cardSchema(FIELDS);
  const genCard = word => gemini.generate(cardPrompt(C.rules, FIELDS, word, { fams: store.famListFor(word), topics: store.topicList() }), SCHEMA, c => c.w);
  const PSCHEMA = PH ? phraseSchema(PH.fields) : null;
  const genPhrase = w => gemini.generate(phrasePrompt(PH, w, store.phraseGroups()), PSCHEMA, goodPhrase);
  const genStarter = () => gemini.generate(starterPrompt(PH, store.phraseGroups()), starterSchema(PH.fields), a => Array.isArray(a) && a.some(goodPhrase));
  /* Ein Auftrag für das Eingabeblatt: Gemini entscheidet selbst, ob Wort (kind w) oder Wendung (kind p); ohne Wendungen ist alles ein Wort */
  const ANY = PH ? anySchema(FIELDS, PH.fields) : null;
  const genAny = word => (PH
    ? gemini.generate(anyPrompt(C, word, { fams: store.famListFor(word), topics: store.topicList(), groups: store.phraseGroups() }), ANY, goodAny)
    : genCard(word).then(c => Object.assign(c, { kind: "w" })));
  const existsAny = card => (card.kind === "p" ? store.existsP(card.w) : store.exists(card.w));
  /* Speichern nach Art: Wort in die Wörter, Wendung in die Wendungen; gibt die gespeicherte Karte zurück */
  const saveAny = async card => { if (card.kind === "p") { const [o] = await savePhrases([card]); return o; } return saveCard(card); };

  /* Freie id in cards.js auf GitHub (taken), im eigenen Bestand und unter den gerade vergebenen (used) */
  const newId = (w, taken, used) => { const id = freeId(w, x => taken(x) || store.hasId(x) || used.has(x)); used.add(id); return id; };
  async function saveCard(card) {
    const [o] = await github.editCards((src, taken) => {
      const id = newId(card.w, taken, new Set());
      card.id = id;
      const o = shapeCard(card, { id, fields: FIELDS, newCat: T("newCat"), store, src: card.src });
      return { out: appendCards(src, [o]), result: [o] };
    }, l => "Neues Wort: " + l[0].w);
    return o;
  }
  const savePhrases = items => github.editCards((src, taken) => {
    const used = new Set();
    const list = items.map(p => {
      const o = { id: newId(p.w, taken, used), k: "p", g: "x", w: p.w.trim(), cat: (p.cat || "").trim() || T("phNewCat"), ar: p.ar };
      if (PH.fields.includes("en")) o.en = p.en || "";
      o.ex = p.ex; if (p.tr) o.tr = p.tr; if (p.note) o.note = p.note; if (p.src) o.src = p.src;
      return o;
    });
    return { out: appendCards(src, list), result: list };
  }, l => (l.length === 1 ? "Neue Wendung: " + l[0].w : l.length + " neue Wendungen"));
  const removeCard = id => github.editCards(src => {
    const list = parseCards(src).filter(c => c.id !== id);
    return { out: serializeCards(headOf(src), list), result: null };
  }, () => "Wort gelöscht: " + id);

  async function deleteCard(id) {
    const c = store.byId(id); if (!c) return;
    if (!S.sync.token) { ctx.flash(T("needTok")); return; }
    if (!confirm(T("delQ").replace("{w}", fullWord(c)))) return;
    hold(true);
    try {
      await removeCard(id);
      store.remove(id);
      ctx.session.drop(id);
      if (S.quiz && S.quiz.c.id === id) S.quiz = null;
      delete S.P.cards[id]; delete S.P.art[id]; ctx.changed();
      S.list.open = null; ctx.flash(T("deleted")); ctx.render();
    } catch (e) { ctx.flash(T("delFail") + " (" + e.message + ")"); }
    hold(false);
  }

  /* Karten ergänzen (einmalig): Wörtern fehlende Felder (en, syn, forms) in Zehnerpaketen, Wendungen fehlendes en in Zwanzigerpaketen
     von Gemini holen, Familien mit mehreren Karten zu einer zusammenlegen, dann cards.js einmal neu schreiben und den Fortschritt
     einmal ändern; gibt die Zahl der geänderten Karten zurück */
  const WANT = ["en", "syn", "forms"].filter(has), WANT_P = PH && PH.fields.includes("en") ? ["en"] : [];
  const wantFor = c => (isP(c) ? WANT_P : WANT), lacks = c => wantFor(c).filter(f => !(f in c));
  const missingWords = () => store.words.filter(c => lacks(c).length), missingPhrases = () => store.phrases.filter(c => lacks(c).length);
  // Familien werden nur zusammengelegt, wenn die App Wortformen kennt (sonst gäbe es keinen Platz für die anderen Karten)
  const families = () => (has("forms") ? store.multiFamilies() : []);
  const fillCount = () => missingWords().length + missingPhrases().length + families().reduce((n, f) => n + f.length - 1, 0);
  async function fill() {
    const patches = new Map();
    const ask = async (list, want, size) => {
      for (let i = 0; i < list.length; i += size) {
        const batch = list.slice(i, i + size), ids = new Set(batch.map(c => c.id));
        const res = await gemini.generate(fillPrompt(C.rules, want, batch), fillSchema(want, FIELDS), a => Array.isArray(a) && a.length > 0);
        res.forEach(r => {
          if (!ids.has(r.id)) return;
          const p = patches.get(r.id) || {};
          want.forEach(f => { if (f in r) p[f] = f === "forms" ? cleanForms(r.forms, has("en"), store.byId(r.id).w) : String(r[f] || "").trim(); });
          patches.set(r.id, p);
        });
      }
    };
    if (WANT.length) await ask(missingWords(), WANT, 10);
    if (WANT_P.length) await ask(missingPhrases(), WANT_P, 20);
    const updated = new Map(); let n = 0;
    for (const c of store.all) {
      const p = patches.get(c.id); if (!p) continue;
      const keep = {}; lacks(c).forEach(f => { if (f in p) keep[f] = p[f]; });
      if (!Object.keys(keep).length) continue;
      updated.set(c.id, withFields(c, keep)); n++;
    }
    const removed = new Set(), entries = new Map();
    for (const fam of families()) {
      const m = mergeFamily(fam.map(c => updated.get(c.id) || c), S.P.cards);
      updated.set(m.base.id, m.base); m.removed.forEach(id => removed.add(id)); if (m.entry) entries.set(m.base.id, m.entry); n += m.removed.length;
    }
    if (!updated.size && !removed.size) return 0;
    await github.editCards(src => ({ out: serializeCards(headOf(src), parseCards(src).filter(c => !removed.has(c.id)).map(c => updated.get(c.id) || c)), result: null }), () => "Karten ergänzt: " + n);
    updated.forEach(c => store.replace(c));
    removed.forEach(id => { store.remove(id); delete S.P.cards[id]; delete S.P.art[id]; ctx.session.drop(id); });
    entries.forEach((e, id) => { S.P.cards[id] = e; });
    if (removed.size || entries.size) ctx.changed();
    ctx.session.ensureCur();
    return n;
  }

  /* ---------- Warteliste: Wörter, die Gemini gerade nicht erstellen konnte ---------- */
  const waiting = kind => Object.entries(S.P.pending || {}).filter(([k, s]) => !s.done && !store.isDone(k) && (!kind || (s.k === "p") === (kind === "p")));
  function queueWord(w, kind) { S.P.pending = S.P.pending || {}; S.P.pending[pkey(w)] = kind ? { w: w, t: Date.now(), k: kind } : { w: w, t: Date.now() }; ctx.changed(); }
  function unqueue(k) { const pend = S.P.pending; if (pend && pend[k]) { const s = pend[k]; pend[k] = Object.assign({ w: s.w, t: Date.now(), done: true }, s.k ? { k: s.k } : {}); ctx.changed(); } }
  let working = false;
  async function refreshCards() {
    if (!S.sync.token) return;
    try {
      const list = await github.readCards();
      if (!list || !list.length) return;
      const fresh = store.syncWith(list);
      if (fresh.length) { ctx.session.ensureCur(); ctx.render(); }
    } catch (e) {}
  }
  async function workQueue() {
    if (working || !S.gkey || !S.sync.token) return;
    working = true;
    try {
      await refreshCards();
      for (const [k, s] of waiting()) {
        if (s.k === "p") {
          if (!PH) continue;
          let ph;
          try { ph = await genPhrase(s.w); } catch (e) { break; }
          if (store.existsP(ph.w)) { unqueue(k); continue; }
          try {
            const [o] = await savePhrases([Object.assign(ph, { src: k })]);
            store.push(o); unqueue(k); ctx.flash(T("autoAdded").replace("{w}", o.w)); ctx.session.refill();
          } catch (e) { break; }
          continue;
        }
        let card;
        try { card = await genCard(s.w); } catch (e) { break; }
        if (!card || !card.w || !card.ar || !card.ex) continue;
        card.src = k;
        if (store.exists(card.w)) { unqueue(k); continue; }
        try {
          const o = await saveCard(card);
          store.push(o);
          unqueue(k); ctx.flash(T("autoAdded").replace("{w}", fullWord(o)));
          ctx.session.ensureCur();
        } catch (e) { break; }
      }
    } finally { working = false; ctx.render(); }
  }
  function startWorker() {
    setInterval(workQueue, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(workQueue, 3000); });
  }
  return { PH, has, genCard, genPhrase, genStarter, genAny, existsAny, saveAny, saveCard, savePhrases, deleteCard, fillCount, fill, waiting, queueWord, unqueue, workQueue, startWorker };
}
