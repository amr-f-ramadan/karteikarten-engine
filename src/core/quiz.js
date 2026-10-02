// Artikel-Quiz: welches Nomen als Nächstes. Oft falsche Nomen kommen häufiger, gut gekonnte seltener, und die zuletzt
// gezeigten kommen nicht gleich wieder, damit sich eine kurze Liste nicht im Kreis dreht. Ohne DOM, damit es sich prüfen lässt.
export const RECENT = 8;

/* Gewicht eines Nomens: ungefragt 3, sonst 1 + 3 je Fehler − ½ je Treffer, nie unter 0.3 */
export const nounWeight = a => Math.max(0.3, 1 + (a ? a.w * 3 - a.ok * 0.5 : 2));

/* Zufällig nach Gewicht aus den Nomen, die nicht unter den zuletzt gezeigten sind (höchstens RECENT, bei wenigen Nomen
   entsprechend weniger, damit immer eines übrig bleibt) */
export function pickNoun(nouns, art, recent, random = Math.random) {
  if (!nouns.length) return null;
  const k = Math.min(RECENT, nouns.length - 1), skip = new Set(k > 0 ? recent.slice(-k) : []);
  const pool = nouns.filter(c => !skip.has(c.id)), w = pool.map(c => nounWeight(art[c.id]));
  let r = random() * w.reduce((a, b) => a + b, 0), i = 0;
  while (i < w.length - 1 && r > w[i]) { r -= w[i]; i++; }
  return pool[i];
}
