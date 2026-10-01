// Fortschritt (progress.json): Form, Zusammenführen zweier Stände.
export const emptyP = () => ({ v: 1, cards: {}, art: {}, pending: {}, newDay: { d: "", n: 0 }, opts: {}, updated: 0 });

/* Pro Karte gewinnt der neuere Eintrag (t); Tageskonto und Optionen vom neueren Stand */
export function merge(a, b) {
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

export const optOf = (P, k, d) => (P.opts && P.opts[k] !== undefined ? P.opts[k] : d);
