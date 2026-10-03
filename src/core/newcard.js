// Neue Karte aus Geminis Antwort formen: dieselben Felder, Familie und Thema in der App (vocab.js) und im Werkzeug (pending.mjs).
import { slug, sameStem, topicOf } from "./text.js";

/* Freie id: wie das Wort, bei Doppelten mit Zahl */
export function freeId(w, isTaken) { let id = slug(w), n = 2; while (isTaken(id)) id = slug(w) + n++; return id; }

/* fields: Felder der App (def nur, wenn die App es hat); newCat: Ersatz-Thema; src: Wartelisten-Schlüssel, aus dem die Karte entstand */
export function shapeCard(c, { id, fields, newCat, store, src }) {
  const o = { id, g: c.g, w: c.w, cat: (c.cat || "").trim() || newCat, hint: c.hint || "", ar: c.ar };
  if (fields.includes("en")) o.en = c.en || "";
  if (fields.includes("def")) o.def = c.def || "";
  o.ex = c.ex; if (c.tr) o.tr = c.tr;
  if (c.perf) o.perf = c.perf; if (c.note) o.note = c.note; if (src) o.src = src;
  // Familie nur, wenn ihr Stamm im Wort steckt; ein eigenes Wort als Familie nur, wenn es die Familie schon gibt
  const fk = (c.fam || "").trim().toLowerCase();
  if (fk && sameStem(o.w, fk) && (fk !== o.w.toLowerCase() || store.hasFam(fk))) o.fam = fk;
  if (o.fam) { const kin = store.famMembers(o.fam).filter(x => x.cat); if (kin.length) o.cat = topicOf(kin); }
  return o;
}

/* en nachtragen, an seinem Platz hinter ar: cards.js bleibt in Feldreihenfolge, die Zeile ändert sich nur um das eine Feld */
export function withEn(c, en) {
  const o = {};
  for (const k of Object.keys(c)) { if (k === "en") continue; o[k] = c[k]; if (k === "ar") o.en = en; }
  if (!("en" in o)) o.en = en;
  return o;
}
