// Reine Textfunktionen, ohne DOM: gemeinsam für die App und die Node-Werkzeuge.
export const ART = { der: "der", die: "die", das: "das", pl: "die", x: "" };
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Heutiges Datum (JJJJ-MM-TT) in der Zeitzone des Geräts; tz für die Erinnerung, die mit der Zone des Telefons aus push.json rechnet.
   Feste Sprache en-GB: in arabischer Spracheinstellung kämen sonst arabische Ziffern. */
const dayFmts = new Map();
export function today(tz, now = new Date()) {
  let f = dayFmts.get(tz || "");
  if (!f) dayFmts.set(tz || "", f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }));
  const p = {}; for (const x of f.formatToParts(now)) p[x.type] = x.value;
  return p.year + "-" + p.month + "-" + p.day;
}
export const startOfDay = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const pickOne = a => a[Math.floor(Math.random() * a.length)];
export const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? v[k] : m));
export const hhmm = (h, m) => String(h).padStart(2, "0") + ":" + String(m || 0).padStart(2, "0");

/* Karten: Wendungen (Redemittel, Satzanfänge, Füllwörter) haben k: "p" */
export const isP = c => c.k === "p";
export const isNoun = c => c.g === "der" || c.g === "die" || c.g === "das";
export const fullWord = c => (ART[c.g] ? ART[c.g] + " " : "") + c.w;
export const gClass = c => "g-" + (c.g || "x");
export const famKey = c => c.fam || c.w.toLowerCase();
export const plainDe = t => String(t || "").toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
export const sameStem = (w, fam) => { const st = plainDe(fam).replace(/(end|ern|eln|en|n|e)$/, ""); return st.length >= 3 && plainDe(w).includes(st); };
export const topicOf = list => { const n = {}; list.forEach(x => { if (x.cat) n[x.cat] = (n[x.cat] || 0) + 1; }); let best = null; for (const x of list) if (x.cat && (!best || n[x.cat] > n[best])) best = x.cat; return best; };
export const slug = w => w.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "").slice(0, 30) || "wort";
/* Schlüssel: Wendungen ohne Satzzeichen, Warteliste ohne Artikel */
export const pk = w => String(w || "").toLowerCase().replace(/[.,!?;:…]+/g, " ").replace(/\s+/g, " ").trim();
export const pkey = w => w.toLowerCase().replace(/^(der|die|das)\s+/, "").trim();
export const wordKey = w => w.toLowerCase().replace(/^(der|die|das)\s+/, "").trim();
/* Suche: ohne Tags, Umlaute und arabische Vokalzeichen */
export const norm = t => String(t || "").toLowerCase().replace(/<[^>]+>/g, "").replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss").replace(/[ً-ْ]/g, "");
