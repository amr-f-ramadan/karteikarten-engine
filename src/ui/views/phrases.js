// Wendungen (Redemittel): eigene Liste nach Verwendungszweck, eigenes Eingabefeld, Grundstock von Gemini.
import { esc, pk, gClass } from "../../core/text.js";
import { boxOf, learnedCount } from "../../core/leitner.js";
import { goodPhrase } from "../../core/prompt.js";
import { $, hold, SLOW_MS } from "../dom.js";
import { dots, field, topicSection, searchBox, waitChips, exRow, arLine, trLine, noteBox } from "../parts.js";
import { emptyAdd } from "../../state.js";

export function createPhrasesPart(ctx, list) {
  const { S, T, C, store, vocab, session, flash } = ctx, PH = C.phrases;
  const gemErr = e => (e.message === "key" ? T("keyBad") : null);

  async function doPGen() {
    const el = $("#np"); if (el) S.pad.word = el.value.trim();
    const A = S.pad;
    if (!A.word || A.busy) return;
    if (!S.gkey) { A.msg = T("needKey"); ctx.render(); return; }
    if (store.existsP(A.word)) { A.msg = T("phDup"); ctx.render(); return; }
    A.busy = "gen"; A.msg = ""; hold(true, SLOW_MS); ctx.render();
    try {
      A.card = await vocab.genPhrase(A.word);
      if (store.existsP(A.card.w)) { A.msg = T("phDup"); A.card = null; A.word = ""; }
    } catch (e) {
      if (gemErr(e)) A.msg = gemErr(e);
      else { vocab.queueWord(A.word, "p"); A.msg = T("phQueued"); A.word = ""; }
    }
    A.busy = false; hold(false); ctx.render();
  }
  async function doPSave() {
    const A = S.pad;
    if (A.busy) return;
    const v = id => { const el = $("#" + id); return el ? el.value.trim() : ""; };
    const card = { w: v("pf_w"), ar: v("pf_ar"), ex: v("pf_ex"), tr: v("pf_tr"), note: v("pf_note"), cat: v("pf_cat") };
    A.card = card;
    if (!card.w || !card.ar || !card.ex) return;
    if (!S.sync.token) { A.msg = T("needTok"); ctx.render(); return; }
    A.busy = "save"; hold(true, SLOW_MS); ctx.render();
    try {
      const [o] = await vocab.savePhrases([card]);
      store.push(o); S.pad = emptyAdd(); flash(T("saved")); session.refill();
    } catch (e) { A.msg = T("genFail") + " (" + e.message + ")"; }
    S.pad.busy = false; hold(false); ctx.render();
  }
  async function doStarter() {
    const A = S.pad;
    if (A.busy) return;
    if (!S.gkey) { A.msg = T("needKey"); ctx.render(); return; }
    if (!S.sync.token) { A.msg = T("needTok"); ctx.render(); return; }
    A.busy = "starter"; A.msg = ""; hold(true, 2 * SLOW_MS); ctx.render();
    try {
      const seen = new Set(store.phrases.map(c => pk(c.w)));
      const list = (await vocab.genStarter()).filter(p => goodPhrase(p) && !seen.has(pk(p.w)) && seen.add(pk(p.w)));
      const saved = list.length ? await vocab.savePhrases(list) : [];
      saved.forEach(o => store.push(o));
      flash(T("phStarterDone").replace("{n}", saved.length)); session.refill();
    } catch (e) { A.msg = gemErr(e) || T("phStarterFail"); }
    A.busy = false; hold(false); ctx.render();
  }

  function renderAdd() {
    const A = S.pad, c = A.card;
    return `<section class="add">
      <h2>${T("phAddH")}</h2>
      <div class="addrow"><input id="np" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("phAddPh"))}" value="${esc(A.word)}">
      <button class="btn ok" data-act="pgen" ${A.busy ? "disabled" : ""}>${A.busy === "gen" ? T("genBusy") : T("gen")}</button></div>
      ${A.msg ? `<p class="addmsg">${esc(A.msg)}</p>` : ""}
      ${waitChips(vocab.waiting("p"), T)}
      ${c ? `<div class="preview">${field("pf_w", T("phF_w"), c.w)}${field("pf_ar", T("f_ar"), c.ar)}${field("pf_ex", T("f_ex"), c.ex, 1)}${PH.fields.includes("tr") ? field("pf_tr", T("f_tr"), c.tr, 1) : ""}${field("pf_note", T("f_note"), c.note, 1)}${field("pf_cat", T("phF_cat"), c.cat)}
        <div class="row2"><button class="btn" data-act="pdiscard">${T("discard")}</button><button class="btn" data-act="pgen">${T("regen")}</button></div>
        <button class="btn ok wide" data-act="psave" ${A.busy ? "disabled" : ""}>${A.busy === "save" ? T("saving") : T("saveCard")}</button></div>` : ""}
      ${store.phrases.length < 10 ? `<div class="starter"><p class="dim">${T("phStarterHelp")}</p><button class="btn wide" data-act="pstart" ${A.busy ? "disabled" : ""}>${A.busy === "starter" ? T("phStarterBusy") : T("phStarter")}</button></div>` : ""}
    </section>`;
  }
  function render() {
    const all = store.phrases, groups = new Map();
    all.forEach(c => {
      const g = c.cat || T("phNewCat");
      if (!groups.has(g)) groups.set(g, []);
      const open = S.list.open === c.id;
      groups.get(g).push(`<li class="${gClass(c)} ph" data-s="${esc(store.hay(c))}"><button class="row" data-act="open" data-id="${c.id}">
        <span class="de word">${esc(c.w)}</span>${dots(boxOf(S.P, c), T)}</button>
        ${open ? `<div class="detail">${arLine(c.ar)}${exRow(c.ex, T("sayEx"))}${trLine(c.tr)}${noteBox(c.note)}<div class="row2"><button class="btn" data-act="sayt" data-t="${esc(c.w.replace(/…/g, ""))}">${T("phSay")}</button><button class="btn again" data-act="del" data-id="${c.id}">${T("delCard")}</button></div></div>` : ""}</li>`);
    });
    const closed = all.length > list.COLLAPSE_AT ? list.closedSet("p", [...groups.keys()]) : null;
    const secs = [...groups.entries()].map(([t, rows]) => topicSection(t, rows, closed ? closed.has(t) : null)).join("");
    return `${renderAdd()}${all.length ? searchBox(S.list.query, T) + `<p class="meta">${T("phStat").replace("{a}", learnedCount(all, S.P)).replace("{t}", all.length)}</p>` : ""}${secs}<p id="nohits" class="meta dim" hidden>${T("noHits")}</p>`;
  }
  return {
    render, doPGen,
    actions: {
      pgen: () => { const w = $("#np"); if (w && S.pad.card && !w.value.trim()) w.value = S.pad.word; doPGen(); },
      psave: doPSave,
      pdiscard: () => { S.pad = emptyAdd(); ctx.render(); },
      pstart: doStarter
    }
  };
}
