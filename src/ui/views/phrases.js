// Wendungen (Redemittel): eigene Ansicht mit eigener Liste nach Verwendungszweck und dem Grundstock von Gemini; neue Wendungen
// entstehen im Eingabeblatt (addsheet).
import { esc, pk, gClass } from "../../core/text.js";
import { boxOf, learnedCount } from "../../core/leitner.js";
import { goodPhrase } from "../../core/prompt.js";
import { hold, SLOW_MS } from "../dom.js";
import { dots, topicSection, searchBox, exRow, trLine, noteBox, meaningLines, meaningMode } from "../parts.js";
import { COLLAPSE_AT, closedSet, listActions } from "../listing.js";

export function createPhrasesView(ctx) {
  const { S, T, C, store, vocab, session, flash } = ctx, PH = C.phrases;
  const gemErr = e => (e.message === "key" ? T("keyBad") : null);

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

  /* Der Grundstock: solange die Liste klein ist, ein Knopf für 30 häufige Wendungen von Gemini */
  function renderStarter() {
    const A = S.pad;
    if (store.phrases.length >= 10) return A.msg ? `<p class="addmsg">${esc(A.msg)}</p>` : "";
    return `<section class="add starter">${A.msg ? `<p class="addmsg">${esc(A.msg)}</p>` : ""}<p class="dim">${T("phStarterHelp")}</p><button class="btn wide" data-act="pstart" ${A.busy ? "disabled" : ""}>${A.busy === "starter" ? T("phStarterBusy") : T("phStarter")}</button></section>`;
  }
  function render() {
    const all = store.phrases, groups = new Map();
    all.forEach(c => {
      const g = c.cat || T("phNewCat");
      if (!groups.has(g)) groups.set(g, []);
      const open = S.list.open === c.id;
      groups.get(g).push(`<li class="${gClass(c)} ph" data-s="${esc(store.hay(c))}"><button class="row" data-act="open" data-id="${c.id}">
        <span class="de word">${esc(c.w)}</span>${dots(boxOf(S.P, c), T)}</button>
        ${open ? `<div class="detail">${meaningLines(c, meaningMode(ctx))}${exRow(c.ex, T("sayEx"))}${trLine(c.tr)}${noteBox(c.note)}<div class="row2"><button class="btn" data-act="sayt" data-t="${esc(c.w.replace(/…/g, ""))}">${T("phSay")}</button><button class="btn again" data-act="del" data-id="${c.id}">${T("delCard")}</button></div></div>` : ""}</li>`);
    });
    const closed = all.length > COLLAPSE_AT ? closedSet(S, "p", [...groups.keys()]) : null;
    const secs = [...groups.entries()].map(([t, rows]) => topicSection(t, rows, closed ? closed.has(t) : null)).join("");
    return `${renderStarter()}${all.length ? searchBox(S.list.query, T) + `<p class="meta">${T("phStat").replace("{a}", learnedCount(all, S.P)).replace("{t}", all.length)}</p>` : ""}${secs}<p id="nohits" class="meta dim" hidden>${T("noHits")}</p>`;
  }
  const shared = listActions(ctx);
  return {
    mode: "phrases", render, enter: shared.enter, after: shared.after, input: shared.input,
    actions: Object.assign({ pstart: doStarter, del: el => vocab.deleteCard(el.dataset.id) }, shared.actions)
  };
}
