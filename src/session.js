// Lernsitzung: Warteschlange der fälligen und neuen Karten, Antworten, Umdrehen.
import { today, shuffle } from "./core/text.js";
import { dueCards, freshCards, recordAnswer } from "./core/leitner.js";
import { $, calm } from "./ui/dom.js";

export function createSession(ctx) {
  const { S, C, store } = ctx, L = S.learn;
  const limits = () => ({ words: ctx.opt("newPerDay", C.newPerDay || 10), phrases: C.phrases ? ctx.opt("newPhrases", C.phrases.perDay || 3) : 0 });
  const due = () => dueCards(store.all, S.P);
  const fresh = () => freshCards(store.words, C.phrases ? store.phrases : null, S.P, today(), limits());
  function buildQueue() { L.queue = shuffle(due()).concat(fresh()); }
  function next() { L.cur = L.queue.shift() || null; L.flipped = false; ctx.render(); }
  /* Keine Karte offen: Warteschlange neu aufbauen und die erste nehmen */
  function ensureCur() { if (!L.cur) { buildQueue(); L.cur = L.queue.shift() || null; L.flipped = false; } }
  function restart() { buildQueue(); next(); }
  /* Neu gespeicherte Karten gleich lernen, soweit das Tageslimit reicht */
  function refill() {
    const inQ = new Set(L.queue.map(c => c.id).concat(L.cur ? [L.cur.id] : []));
    fresh().filter(c => !inQ.has(c.id)).forEach(c => L.queue.push(c));
    if (!L.cur) { L.cur = L.queue.shift() || null; L.flipped = false; }
  }
  function answer(ok) {
    const c = L.cur;
    recordAnswer(S.P, c, ok, Date.now(), today());
    if (!ok) L.queue.push(c);
    ctx.changed();
    next();
  }
  function flip() {
    if (L.flipped || L.turning) return;
    const el = $("#card");
    if (!el || !el.animate || calm()) { L.flipped = true; ctx.render(); return; }
    L.turning = true;
    el.animate([{ transform: "perspective(1000px) rotateY(0deg)" }, { transform: "perspective(1000px) rotateY(90deg)" }], { duration: 170, easing: "ease-in", fill: "forwards" }).onfinish = () => {
      L.flipped = true; ctx.render();
      const n = $("#card");
      if (n) n.animate([{ transform: "perspective(1000px) rotateY(-90deg)" }, { transform: "perspective(1000px) rotateY(0deg)" }], { duration: 220, easing: "ease-out" });
      L.turning = false;
    };
  }
  /* Karte aus der Sitzung nehmen (gelöscht) */
  function drop(id) {
    L.queue = L.queue.filter(x => x.id !== id);
    if (L.cur && L.cur.id === id) { L.cur = L.queue.shift() || null; L.flipped = false; }
  }
  return { limits, due, fresh, buildQueue, next, ensureCur, restart, refill, answer, flip, drop, dueCount: () => due().length + fresh().length };
}
