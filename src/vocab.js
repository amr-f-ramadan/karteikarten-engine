// Wortschatz pflegen: neue Karten und Wendungen mit Gemini, Speichern in cards.js, Löschen, Warteliste.
import { fullWord, pkey } from "./core/text.js";
import { cardPrompt, cardSchema, phrasePrompt, phraseSchema, starterPrompt, starterSchema, goodPhrase } from "./core/prompt.js";
import { appendCards, serializeCards, parseCards, headOf } from "./core/cardsfile.js";
import { freeId, shapeCard } from "./core/newcard.js";
import { hold } from "./ui/dom.js";

export function createVocab(ctx) {
  const { C, T, S, store, github, gemini } = ctx, PH = C.phrases || null;
  /* Felder und Regeln für neue Karten kommen aus index.html (C.fields, C.rules mit intro und end) */
  const FIELDS = C.fields, has = f => FIELDS.includes(f), SCHEMA = cardSchema(FIELDS);
  const genCard = word => gemini.generate(cardPrompt(C.rules, FIELDS, word, { fams: store.famListFor(word), topics: store.topicList() }), SCHEMA, c => c.w);
  const PSCHEMA = PH ? phraseSchema(PH.fields) : null;
  const genPhrase = w => gemini.generate(phrasePrompt(PH, w, store.phraseGroups()), PSCHEMA, goodPhrase);
  const genStarter = () => gemini.generate(starterPrompt(PH, store.phraseGroups()), starterSchema(PH.fields), a => Array.isArray(a) && a.some(goodPhrase));

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
      const o = { id: newId(p.w, taken, used), k: "p", g: "x", w: p.w.trim(), cat: (p.cat || "").trim() || T("phNewCat"), ar: p.ar, ex: p.ex };
      if (p.tr) o.tr = p.tr; if (p.note) o.note = p.note; if (p.src) o.src = p.src;
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
  return { PH, has, genCard, genPhrase, genStarter, saveCard, savePhrases, deleteCard, waiting, queueWord, unqueue, workQueue, startWorker };
}
