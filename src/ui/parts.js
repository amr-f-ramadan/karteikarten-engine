// Wiederkehrende HTML-Bausteine der Ansichten.
import { esc, ART, fullWord, gClass } from "../core/text.js";
import { INT } from "../core/leitner.js";
import { cleanSyn } from "../core/newcard.js";
import { plain } from "./dom.js";

export const speakBtn = (what, label) => `<button class="say" data-say="${what}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg></button>`;
/* Lautsprecher für einen festen Text (Beispielsatz, Wendung) */
export const sayT = (text, label) => speakBtn("", label).replace('data-say=""', `data-t="${esc(plain(text))}"`);
export const wordHTML = c => `<span class="de word">${ART[c.g] ? `<span class="art">${ART[c.g]}</span> ` : ""}${esc(c.w)}</span>`;
export const famChip = c => `<button class="famchip de ${gClass(c)}" data-act="sayt" data-t="${esc(fullWord(c))}">${ART[c.g] ? `<span class="art">${ART[c.g]}</span> ` : ""}${esc(c.w)}</button>`;
export const famRow = (relatives, T) => (relatives.length ? `<div class="famrow"><span class="famh">${T("famH")}</span>${relatives.map(famChip).join("")}</div>` : "");
/* Lernstufe als Punkte (b = -1 für ungelernt) */
export const dots = (b, T) => `<span class="lvl" aria-label="${T("level")} ${Math.max(b, 0)}">${Array.from({ length: INT.length - 1 }, (_, i) => `<i class="${i < b ? "on" : ""}"></i>`).join("")}</span>`;
export const field = (id, label, val, big) => `<label class="fld">${label}${big ? `<textarea id="${id}" rows="2" dir="auto">${esc(val || "")}</textarea>` : `<input id="${id}" dir="auto" value="${esc(val || "")}">`}</label>`;
/* closed: Thema eingeklappt (lange Listen); null = Liste nicht einklappbar */
export const topicSection = (title, rows, closed = null) => `<section class="topic${closed === null ? "" : closed ? " coll closed" : " coll"}" data-topic="${esc(title)}"><h3${closed === null ? "" : ' data-act="topic"'}><span>${esc(title)}</span><span class="tcount">${rows.length}</span></h3><ul class="list">${rows.join("")}</ul></section>`;
export const searchBox = (query, T) => `<input id="q" class="search" type="search" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("searchPh"))}" value="${esc(query)}">`;
export const waitChips = (entries, T) => (entries.length ? `<div class="wait"><p class="waith">${T("waitH")}</p>${entries.map(([k, s]) => `<span class="chip de">${esc(s.w)}<button data-act="unq" data-k="${esc(k)}" aria-label="${T("waitRm")}">×</button></span>`).join("")}</div>` : "");
export const exRow = (ex, label) => `<div class="exrow"><p class="ex de">${ex}</p>${sayT(ex, label)}</div>`;
export const arLine = ar => `<p class="ar" lang="ar" dir="rtl">${esc(ar)}</p>`;
export const enLine = en => (en ? `<p class="en" lang="en" dir="ltr">${esc(en)}</p>` : "");
/* Bedeutung: Arabisch, Englisch oder beides (Option meaning), nur wenn die App das Feld en hat; fehlt en auf einer Karte, bleibt Arabisch */
export const meaningMode = ctx => (ctx.vocab.has("en") ? ctx.opt("meaning", "ar") : "ar");
export const meaningLines = (c, mode) => (mode === "en" && c.en ? enLine(c.en) : mode === "both" ? arLine(c.ar) + enLine(c.en) : arLine(c.ar));
export const meaningBig = (c, mode) => (mode === "en" && c.en ? `<p class="en-big" lang="en" dir="ltr">${esc(c.en)}</p>`
  : `<p class="ar-big">${esc(c.ar)}</p>${mode === "both" && c.en ? `<p class="en-big sub" lang="en" dir="ltr">${esc(c.en)}</p>` : ""}`);
export const trLine = tr => (tr ? `<p class="tr" lang="ar" dir="rtl">${esc(tr)}</p>` : "");
export const noteBox = note => (note ? `<p class="note">${note}</p>` : "");
/* Der Knopf für das einmalige Ergänzen (Einstellungen und Wörterliste): n Karten, busy während Gemini arbeitet */
export const fillButton = (n, busy, T) => (n ? `<button class="btn wide fillbtn" data-act="fillen" ${busy ? "disabled" : ""}>${busy ? T("fillBusy") : T("fill").replace("{n}", n)}</button>` : "");
/* Synonyme als Chips: ein Wort, das in der Liste ist, bekommt die Aktion act (goto öffnet seine Karte, sayt spricht es); ein fremdes wird nur gesprochen */
export const synRow = (c, store, T, act) => {
  const items = cleanSyn(c.syn, c.w).split(",").map(s => s.trim()).filter(Boolean); // auch alte, schon gespeicherte Felder nur gekürzt zeigen
  return items.length ? `<div class="famrow syn"><span class="famh">${T("synH")}</span>${items.map(s => { const hit = store.find(s); return hit
    ? `<button class="famchip de ${gClass(hit)}" data-act="${act}" data-id="${hit.id}" data-t="${esc(fullWord(hit))}">${esc(s)}</button>`
    : `<button class="famchip de g-x dim" data-act="sayt" data-t="${esc(s)}">${esc(s)}</button>`; }).join("")}</div>` : "";
};
const POS = { n: "posN", v: "posV", adj: "posAdj", adv: "posAdv" };
/* Wortformen der Karte als Zeilen mit Wortart; die gerade gelernte (face) ist hervorgehoben */
export const formsRow = (c, face, T) => (c.forms && c.forms.length ? `<div class="forms"><span class="famh">${T("formsH")}</span>${c.forms.map((f, i) =>
  `<button class="form de ${gClass(f)}${face === i + 1 ? " on" : ""}" data-act="sayt" data-t="${esc(fullWord(f))}"><span class="pos">${T(POS[f.pos] || "posN")}</span> ${ART[f.g] ? `<span class="art">${ART[f.g]}</span> ` : ""}${esc(f.w)}</button>`).join("")}</div>` : "");
