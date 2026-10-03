// Eingabeblatt: ein Plus im Kopf öffnet ein Glasblatt mit einem Feld. Gemini entscheidet, ob die Eingabe ein Wort oder eine
// Wendung ist, und baut die Karte; die Vorschau zeigt die Art und die Felder dieser Art; Speichern legt sie in die passende
// Liste. Die Warteliste (Wörter, die Gemini gerade nicht konnte) wohnt hier. Der Entwurf liegt in S.add und überlebt den Neustart.
import { esc } from "../core/text.js";
import { $, hold, SLOW_MS } from "./dom.js";
import { field, waitChips } from "./parts.js";
import { emptyAdd } from "../state.js";

export function createAddSheet(ctx) {
  const { S, T, C, store, vocab, session, flash } = ctx, PH = C.phrases || null;
  const plus = document.createElement("button");
  plus.className = "plus"; plus.setAttribute("aria-label", T("addH")); plus.dataset.act = "addopen";
  plus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const sheet = document.createElement("section");
  sheet.id = "sheet"; sheet.className = "sheet"; sheet.hidden = true; sheet.setAttribute("aria-label", T("addH"));
  document.body.append(plus, sheet);

  const kind = () => (S.add.card && S.add.card.kind) || "w";
  /* Die Felder der Vorschau: für ein Wort die der App, für eine Wendung die der Wendungen; die ids bleiben wie in den alten Formularen */
  function readForm() {
    const v = id => { const el = $("#" + id); return el ? el.value.trim() : ""; };
    if (kind() === "p") return { kind: "p", w: v("pf_w"), ar: v("pf_ar"), en: v("pf_en"), ex: v("pf_ex"), tr: v("pf_tr"), note: v("pf_note"), cat: v("pf_cat") };
    const c = S.add.card || {};
    return { kind: "w", w: v("f_w"), g: v("f_g") || "x", hint: v("f_hint"), perf: v("f_perf"), ar: v("f_ar"), en: v("f_en"), def: v("f_def"), ex: v("f_ex"), tr: v("f_tr"), note: v("f_note"), syn: v("f_syn"), forms: c.forms, fam: v("f_fam"), cat: v("f_cat") };
  }
  async function doGen() {
    const el = $("#nw"); if (el) S.add.word = el.value.trim();
    const A = S.add;
    if (!A.word || A.busy) return;
    if (!S.gkey) { A.msg = T("needKey"); ctx.render(); return; }
    if (store.exists(A.word) || (PH && store.existsP(A.word))) { A.msg = T("dup"); ctx.render(); return; }
    A.busy = "gen"; A.msg = ""; hold(true, SLOW_MS); ctx.render();
    try {
      A.card = await vocab.genAny(A.word);
      // Eingabe auf Arabisch oder Englisch: erst jetzt steht das deutsche Wort fest
      if (vocab.existsAny(A.card)) { A.msg = T(A.card.kind === "p" ? "phDup" : "dup"); A.card = null; A.word = ""; }
    } catch (e) {
      if (e.message === "key") A.msg = T("keyBad");
      else { vocab.queueWord(A.word); A.msg = T("queued"); A.word = ""; }
    }
    A.busy = false; hold(false); ctx.render();
  }
  async function doSave() {
    const A = S.add;
    if (A.busy) return;
    const card = readForm(); A.card = card;
    if (!card.w || !card.ar || !card.ex) return;
    if (!S.sync.token) { A.msg = T("needTok"); ctx.render(); return; }
    A.busy = "save"; hold(true, SLOW_MS); ctx.render();
    try {
      const o = await vocab.saveAny(card);
      store.push(o);
      S.add = emptyAdd(); flash(T("saved"));
      if (card.kind === "p") session.refill(); else session.ensureCur();
    } catch (e) { A.busy = false; A.msg = T("genFail") + " (" + e.message + ")"; }
    S.add.busy = false; hold(false); ctx.render();
  }
  function preview() {
    const c = S.add.card; if (!c) return "";
    const f = (id, key, val, big) => field(id, T(key), val, big);
    const tag = `<p class="kind"><span class="new">${T(c.kind === "p" ? "kindP" : "kindW")}</span></p>`;
    const body = c.kind === "p"
      ? `${f("pf_w", "phF_w", c.w)}${f("pf_ar", "f_ar", c.ar)}${PH.fields.includes("en") ? f("pf_en", "f_en", c.en) : ""}${f("pf_ex", "f_ex", c.ex, 1)}${PH.fields.includes("tr") ? f("pf_tr", "f_tr", c.tr, 1) : ""}${f("pf_note", "f_note", c.note, 1)}${f("pf_cat", "phF_cat", c.cat)}`
      : `${f("f_w", "f_w", c.w)}<label class="fld">${T("f_g")}<select id="f_g">${["der", "die", "das", "pl", "x"].map(g => `<option value="${g}" ${c.g === g ? "selected" : ""}>${g === "x" ? T("g_x") : g === "pl" ? T("g_pl") : g}</option>`).join("")}</select></label>${f("f_hint", "f_hint", c.hint)}${vocab.has("perf") ? f("f_perf", "f_perf", c.perf) : ""}${f("f_ar", "f_ar", c.ar)}${vocab.has("en") ? f("f_en", "f_en", c.en) : ""}${vocab.has("def") ? f("f_def", "f_def", c.def, 1) : ""}${f("f_ex", "f_ex", c.ex, 1)}${vocab.has("tr") ? f("f_tr", "f_tr", c.tr, 1) : ""}${f("f_note", "f_note", c.note, 1)}${vocab.has("syn") ? f("f_syn", "synH", c.syn) : ""}${vocab.has("forms") && c.forms && c.forms.length ? `<p class="fld"><span>${T("formsH")}</span><span class="dim de">${c.forms.map(x => esc((x.g !== "x" ? x.g + " " : "") + x.w)).join(", ")}</span></p>` : ""}${f("f_cat", "f_cat", c.cat)}${f("f_fam", "f_fam", c.fam)}`;
    return `<div class="preview">${tag}${body}
      <div class="row2"><button class="btn" data-act="discard">${T("discard")}</button><button class="btn" data-act="gen">${T("regen")}</button></div>
      <button class="btn ok wide" data-act="savecard" ${S.add.busy ? "disabled" : ""}>${S.add.busy === "save" ? T("saving") : T("saveCard")}</button></div>`;
  }
  function render() {
    const A = S.add;
    sheet.hidden = !A.open; document.body.classList.toggle("sheet-open", !!A.open); plus.setAttribute("aria-expanded", String(!!A.open));
    if (!A.open) return;
    sheet.innerHTML = `<div class="sheethead"><h2>${T("addH")}</h2><button class="x" data-act="addclose" aria-label="${esc(T("close"))}">×</button></div>
      <div class="addrow"><input id="nw" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("addPh"))}" value="${esc(A.word)}">
      <button class="btn ok" data-act="gen" ${A.busy ? "disabled" : ""}>${A.busy === "gen" ? T("genBusy") : T("gen")}</button></div>
      ${A.msg ? `<p class="addmsg">${esc(A.msg)}</p>` : ""}
      ${waitChips(vocab.waiting(), T)}
      ${preview()}`;
  }
  return {
    render,
    actions: {
      addopen: () => { S.add.open = true; ctx.render(); const el = $("#nw"); if (el && !S.add.card) el.focus(); },
      addclose: () => { S.add.open = false; ctx.render(); },
      gen: () => { const w = $("#nw"); if (w && S.add.card && !w.value.trim()) w.value = S.add.word; doGen(); },
      savecard: doSave,
      discard: () => { S.add = emptyAdd(); S.add.open = true; ctx.render(); },
      unq: el => { vocab.unqueue(el.dataset.k); ctx.render(); }
    },
    keys(e) {
      if (!S.add.open) return false;
      if (e.target.id === "nw" && e.key === "Enter") { e.preventDefault(); doGen(); return true; }
      if (e.key === "Escape" && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { S.add.open = false; ctx.render(); return true; }
      return /INPUT|TEXTAREA|SELECT/.test(e.target.tagName); // Tasten in den Feldern des Blatts gehören dem Blatt, nicht der Ansicht
    }
  };
}
