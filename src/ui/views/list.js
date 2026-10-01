// Wörterliste nach Themen, Wortfamilien zusammen; neues Wort mit Gemini; Suche. Mit Wendungen: Umschalter zur Wendungsliste.
import { esc, fullWord, topicOf, gClass, norm } from "../../core/text.js";
import { boxOf, learnedCount } from "../../core/leitner.js";
import { $, hold, SLOW_MS } from "../dom.js";
import { wordHTML, dots, field, topicSection, searchBox, waitChips, famRow, exRow, arLine, trLine } from "../parts.js";
import { emptyAdd } from "../../state.js";
import { createPhrasesPart } from "./phrases.js";

export function createListView(ctx) {
  const { S, T, C, store, vocab, session, flash } = ctx, PH = C.phrases || null;
  const phrases = PH ? createPhrasesPart(ctx) : null;

  function applyFilter() {
    const q = norm(S.list.query).trim();
    let any = false;
    document.querySelectorAll(".topic").forEach(sec => {
      let n = 0;
      sec.querySelectorAll("li").forEach(li => { const hit = !q || li.dataset.s.includes(q); li.hidden = !hit; if (hit) n++; });
      sec.hidden = !n; if (n) any = true;
      const cnt = sec.querySelector(".tcount"); if (cnt) cnt.textContent = n;
    });
    const nh = $("#nohits"); if (nh) nh.hidden = any;
  }

  function readForm() {
    const v = id => { const el = $("#" + id); return el ? el.value.trim() : ""; };
    return { w: v("f_w"), g: v("f_g") || "x", hint: v("f_hint"), perf: v("f_perf"), ar: v("f_ar"), def: v("f_def"), ex: v("f_ex"), tr: v("f_tr"), note: v("f_note"), fam: v("f_fam"), cat: v("f_cat") };
  }
  async function doGen() {
    const el = $("#nw"); if (el) S.add.word = el.value.trim();
    const A = S.add;
    if (!A.word || A.busy) return;
    if (!S.gkey) { A.msg = T("needKey"); ctx.render(); return; }
    if (store.exists(A.word)) { A.msg = T("dup"); ctx.render(); return; }
    A.busy = "gen"; A.msg = ""; hold(true, SLOW_MS); ctx.render();
    try {
      A.card = await vocab.genCard(A.word);
      // Eingabe auf Arabisch oder Englisch: erst jetzt steht das deutsche Wort fest
      if (store.exists(A.card.w)) { A.msg = T("dup"); A.card = null; A.word = ""; }
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
      const o = await vocab.saveCard(card);
      store.push(o);
      S.add = emptyAdd(); flash(T("saved"));
      session.ensureCur();
    } catch (e) { A.busy = false; A.msg = T("genFail") + " (" + e.message + ")"; }
    S.add.busy = false; hold(false); ctx.render();
  }

  function renderAdd() {
    const A = S.add, c = A.card, f = (id, val, big) => field(id, T(id), val, big);
    const sel = c ? `<label class="fld">${T("f_g")}<select id="f_g">${["der", "die", "das", "pl", "x"].map(g => `<option value="${g}" ${c.g === g ? "selected" : ""}>${g === "x" ? T("g_x") : g === "pl" ? T("g_pl") : g}</option>`).join("")}</select></label>` : "";
    return `<section class="add">
      <h2>${T("addH")}</h2>
      <div class="addrow"><input id="nw" dir="auto" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(T("addPh"))}" value="${esc(A.word)}">
      <button class="btn ok" data-act="gen" ${A.busy ? "disabled" : ""}>${A.busy === "gen" ? T("genBusy") : T("gen")}</button></div>
      ${A.msg ? `<p class="addmsg">${esc(A.msg)}</p>` : ""}
      ${waitChips(vocab.waiting("w"), T)}
      ${c ? `<div class="preview">${f("f_w", c.w)}${sel}${f("f_hint", c.hint)}${vocab.has("perf") ? f("f_perf", c.perf) : ""}${f("f_ar", c.ar)}${vocab.has("def") ? f("f_def", c.def, 1) : ""}${f("f_ex", c.ex, 1)}${vocab.has("tr") ? f("f_tr", c.tr, 1) : ""}${f("f_note", c.note, 1)}${f("f_cat", c.cat)}${f("f_fam", c.fam)}
        <div class="row2"><button class="btn" data-act="discard">${T("discard")}</button><button class="btn" data-act="gen">${T("regen")}</button></div>
        <button class="btn ok wide" data-act="savecard" ${A.busy ? "disabled" : ""}>${A.busy === "save" ? T("saving") : T("saveCard")}</button></div>` : ""}
    </section>`;
  }
  function renderSeg() {
    if (!PH) return "";
    const b = (k, label, n) => `<button data-act="lk" data-k="${k}" aria-pressed="${S.list.kind === k}">${label} <span class="segn">${n}</span></button>`;
    return `<div class="seg">${b("w", T("segW"), store.words.length)}${b("p", T("segP"), store.phrases.length)}</div>`;
  }
  function renderWords() {
    const topics = new Map();
    let famTopic = null;
    store.grouped().forEach(([c, sub, inFam]) => {
      if (!sub) famTopic = topicOf(store.family(c)) || T("newCat");
      if (!topics.has(famTopic)) topics.set(famTopic, []);
      const open = S.list.open === c.id;
      topics.get(famTopic).push(`<li class="${gClass(c)}${sub ? " sub" : ""}${inFam ? " infam" : ""}" data-s="${esc(store.hay(c))}"><button class="row" data-act="open" data-id="${c.id}">
        ${wordHTML(c)}${dots(boxOf(S.P, c), T)}</button>
        ${open ? `<div class="detail">${arLine(c.ar)}${c.perf ? `<p class="perf de">${T("perfL")} <b>${esc(c.perf)}</b></p>` : ""}${exRow(c.ex, T("sayEx"))}${trLine(c.tr)}${famRow(store.relatives(c), T)}<div class="row2"><button class="btn" data-act="sayt" data-t="${esc(fullWord(c))}">${T("phSay")}</button><button class="btn again" data-act="del" data-id="${c.id}">${T("delCard")}</button></div></div>` : ""}</li>`);
    });
    const secs = [...topics.entries()].map(([t, rows]) => topicSection(t, rows)).join("");
    const words = store.words;
    return `${renderAdd()}${searchBox(S.list.query, T)}
      <p class="meta">${T("listStat").replace("{a}", learnedCount(words, S.P)).replace("{t}", words.length)}</p>${secs}<p id="nohits" class="meta dim" hidden>${T("noHits")}</p>`;
  }
  const render = () => renderSeg() + (PH && S.list.kind === "p" ? phrases.render() : renderWords());

  return {
    mode: "list", render,
    after() { if (S.list.query) applyFilter(); },
    actions: Object.assign({
      open: el => { S.list.open = S.list.open === el.dataset.id ? null : el.dataset.id; ctx.render(); },
      gen: () => { const w = $("#nw"); if (w && S.add.card && !w.value.trim()) w.value = S.add.word; doGen(); },
      savecard: doSave,
      del: el => vocab.deleteCard(el.dataset.id),
      unq: el => { vocab.unqueue(el.dataset.k); ctx.render(); },
      discard: () => { S.add = emptyAdd(); ctx.render(); },
      lk: el => { S.list.kind = el.dataset.k; S.list.open = null; S.list.query = ""; ctx.render(); }
    }, phrases ? phrases.actions : {}),
    input: { q: el => { S.list.query = el.value; applyFilter(); } },
    keys(e) {
      if (e.target.id === "nw" && e.key === "Enter") { e.preventDefault(); doGen(); }
      else if (e.target.id === "np" && e.key === "Enter" && phrases) { e.preventDefault(); phrases.doPGen(); }
    }
  };
}
