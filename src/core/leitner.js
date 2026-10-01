// Leitner-Wiederholung: Stufen 0..6 mit festen Abständen in Tagen. Reine Funktionen über dem Fortschritt P.
import { isP, startOfDay } from "./text.js";

export const DAY = 864e5, INT = [0, 1, 3, 7, 14, 30, 60];
export const MAX_BOX = INT.length - 1;

/* Heute schon gelernte neue Karten (kind "p" für Wendungen) */
export const newToday = (P, day, kind) => (P.newDay && P.newDay.d === day ? (kind === "p" ? P.newDay.p || 0 : P.newDay.n) : 0);

export function dueCards(cards, P, now = Date.now()) {
  return cards.filter(c => P.cards[c.id] && P.cards[c.id].due <= now).sort((a, b) => P.cards[a.id].due - P.cards[b.id].due);
}

/* Neue Karten für heute: erst Wörter, dann Wendungen, jede Art mit eigenem Tageslimit. phrases null = Wendungen aus. */
export function freshCards(words, phrases, P, day, limits) {
  const left = Math.max(0, limits.words - newToday(P, day));
  const out = words.filter(c => !P.cards[c.id]).slice(0, left);
  if (!phrases) return out;
  const leftP = Math.max(0, limits.phrases - newToday(P, day, "p"));
  return out.concat(phrases.filter(c => !P.cards[c.id]).slice(0, leftP));
}

/* Antwort eintragen: neue Karte zählt für heute; richtig = eine Stufe hoch, falsch = zurück auf 0 und sofort wieder fällig */
export function recordAnswer(P, c, ok, now, day) {
  let s = P.cards[c.id];
  if (!s) {
    s = P.cards[c.id] = { b: 0, due: now, t: now, n: 0, w: 0 };
    if (!P.newDay || P.newDay.d !== day) P.newDay = { d: day, n: 0 };
    if (isP(c)) P.newDay.p = (P.newDay.p || 0) + 1; else P.newDay.n++;
  }
  s.n++; s.t = now;
  if (ok) { s.b = Math.min(s.b + 1, MAX_BOX); s.due = startOfDay(now) + INT[s.b] * DAY; }
  else { s.w++; s.b = 0; s.due = now; }
  return s;
}

/* "Weitere neue Wörter": das Tageskonto um ein Tageslimit entlasten, Wendungen bleiben gezählt */
export function allowMoreNew(P, day, perDay) {
  const p = newToday(P, day, "p");
  P.newDay = { d: day, n: Math.max(0, newToday(P, day) - perDay) };
  if (p) P.newDay.p = p;
}

export const dueByTomorrow = (cards, P, now = Date.now()) => cards.filter(c => P.cards[c.id] && P.cards[c.id].due <= startOfDay(now) + 2 * DAY).length;
export const learnedCount = (cards, P) => cards.filter(c => P.cards[c.id] && P.cards[c.id].b >= 3).length;
export const boxOf = (P, c) => (P.cards[c.id] ? P.cards[c.id].b : -1);
