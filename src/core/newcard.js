// Neue Karte aus Geminis Antwort formen: dieselben Felder, Familie und Thema in der App (vocab.js) und im Werkzeug (pending.mjs).
// Dazu: Felder nachtragen (withFields), Wortfamilien zu einer Karte zusammenlegen (mergeFamily), Wortart raten (guessPos).
import { slug, sameStem, topicOf, famKey } from "./text.js";

/* Freie id: wie das Wort, bei Doppelten mit Zahl */
export function freeId(w, isTaken) { let id = slug(w), n = 2; while (isTaken(id)) id = slug(w) + n++; return id; }

/* fields: Felder der App (def nur, wenn die App es hat); newCat: Ersatz-Thema; src: Wartelisten-Schlüssel, aus dem die Karte entstand */
export function shapeCard(c, { id, fields, newCat, store, src }) {
  const o = { id, g: c.g, w: c.w, cat: (c.cat || "").trim() || newCat, hint: c.hint || "", ar: c.ar };
  if (fields.includes("en")) o.en = c.en || "";
  if (fields.includes("def")) o.def = c.def || "";
  o.ex = c.ex; if (c.tr) o.tr = c.tr;
  // syn und forms stehen auch leer in der Karte: so ist zu sehen, dass sie schon erfragt wurden
  if (fields.includes("syn")) o.syn = (c.syn || "").trim();
  if (fields.includes("forms")) o.forms = cleanForms(c.forms, fields.includes("en"), c.w);
  if (c.perf) o.perf = c.perf; if (c.note) o.note = c.note; if (src) o.src = src;
  // Familie nur, wenn ihr Stamm im Wort steckt; ein eigenes Wort als Familie nur, wenn es die Familie schon gibt
  const fk = (c.fam || "").trim().toLowerCase();
  if (fk && sameStem(o.w, fk) && (fk !== o.w.toLowerCase() || store.hasFam(fk))) o.fam = fk;
  if (o.fam) { const kin = store.famMembers(o.fam).filter(x => x.cat); if (kin.length) o.cat = topicOf(kin); }
  return o;
}

/* Wortformen aus einer Antwort: nur vollständige, ohne das Wort selbst, ohne Doppelte; en nur, wenn die App es hat */
export function cleanForms(list, withEnField, self = "") {
  const seen = new Set([self.toLowerCase()]), out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const w = (f && f.w || "").trim(); if (!w || seen.has(w.toLowerCase()) || !f.ar) continue;
    seen.add(w.toLowerCase());
    const o = { w, g: ["der", "die", "das", "pl"].includes(f.g) ? f.g : "x", pos: ["n", "v", "adj", "adv"].includes(f.pos) ? f.pos : guessPos(w, f.g), ar: f.ar };
    if (withEnField) o.en = f.en || "";
    out.push(o);
  }
  return out;
}
/* Wortart ohne Angabe: Nomen am Artikel, Verb an der Endung -en (auch "sich … auf"), sonst Adjektiv */
export const guessPos = (w, g) => (["der", "die", "das", "pl"].includes(g) ? "n" : w.split(/\s+/).some(x => /en$/.test(x) && x.length > 3) ? "v" : "adj");

/* Felder nachtragen, jedes an seinem Platz (en hinter ar, syn hinter tr oder ex, forms hinter syn): cards.js bleibt in
   Feldreihenfolge, die Zeile ändert sich nur um die neuen Felder; leer heißt erfragt und nichts gefunden */
const SLOT = { en: ["ar"], syn: ["tr", "ex"], forms: ["syn", "tr", "ex"] };
export function withFields(c, patch) {
  const add = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) add[k] = v;
  const keys = Object.keys(c).filter(k => !(k in add)), after = {};
  for (const f of Object.keys(SLOT)) if (f in add) { const a = SLOT[f].find(x => keys.includes(x) || x in add) || ""; (after[a] = after[a] || []).push(f); }
  const o = {}, emit = f => { o[f] = add[f]; (after[f] || []).forEach(emit); };
  for (const k of keys) { o[k] = c[k]; (after[k] || []).forEach(emit); }
  (after[""] || []).forEach(emit);
  return o;
}
export const withEn = (c, en) => withFields(c, { en });

/* Eine Familie (mehrere Karten mit demselben Stamm) wird eine Karte: der Stamm selbst ist die Basis, sonst das kürzeste Wort,
   das ihn enthält, sonst die erste; die anderen werden Wortformen; der Fortschritt der Basis ist der höchste Kasten (bei
   gleichem Kasten der frühere Termin). Gibt Basis, die ids der aufgelösten Karten und den Fortschritt der Basis zurück */
export function mergeFamily(members, progress = {}) {
  const key = famKey(members[0]).toLowerCase();
  const low = c => c.w.toLowerCase();
  const base = members.find(c => low(c) === key) || members.filter(c => low(c).includes(key)).sort((a, b) => a.w.length - b.w.length)[0] || members[0];
  const others = members.filter(c => c !== base);
  const forms = cleanForms((base.forms || []).concat(others.map(c => ({ w: c.w, g: c.g, pos: guessPos(c.w, c.g), ar: c.ar, en: c.en }))), "en" in base || others.some(c => "en" in c), base.w);
  const entries = members.map(c => progress[c.id]).filter(Boolean).sort((a, b) => (b.b - a.b) || (a.due - b.due));
  return { base: withFields(base, { forms }), removed: others.map(c => c.id), entry: entries[0] || null };
}

/* Welche Seite der Karte gelernt wird: 0 die Basis (jedes zweite Mal), sonst eine Wortform; r aus [0, 1) */
export const pickFace = (c, r = Math.random()) => (!c.forms || !c.forms.length || r < 0.5 ? 0 : 1 + Math.floor((r - 0.5) * 2 * c.forms.length));
/* Das Wort, das die Seite zeigt: die Basis oder die Wortform mit allem, was die Vorderseite braucht */
export const faceOf = (c, i) => (i && c.forms && c.forms[i - 1] ? Object.assign({}, c, c.forms[i - 1], { hint: "" }) : c);
