// Lernen: Vorderseite (Wort oder, bei bekannten Karten, erst die Bedeutung), Rückseite mit allem, Nochmal/Gewusst.
import { esc, today, isP } from "../../core/text.js";
import { dueByTomorrow, allowMoreNew } from "../../core/leitner.js";
import { gClass } from "../../core/text.js";
import { calm } from "../dom.js";
import { speakBtn, wordHTML, famRow, arLine, trLine, noteBox } from "../parts.js";

export function createLearnView(ctx) {
  const { S, T, C, store, session } = ctx, L = S.learn;
  function render() {
    const due = session.due().length, fresh = session.fresh().length;
    if (!L.cur) {
      return `<div class="done"><p class="big">${T("doneTitle")}</p><p>${T("doneText").replace("{n}", dueByTomorrow(store.all, S.P))}</p>
        <button class="btn" data-act="more">${T("moreNew")}</button></div>`;
    }
    const c = L.cur, s = S.P.cards[c.id], always = ctx.opt("arFirst", false);
    const arFirst = always || (ctx.opt("prodAuto", true) && !!s && s.b >= 2);
    const front = arFirst
      ? `<p class="ar-big">${esc(c.ar)}</p><p class="hint">${T(always ? "whatDe" : isP(c) ? "sayPh" : "sayDe")}</p>${calm() ? "" : '<div class="timer"></div>'}`
      : `${wordHTML(c)}${c.hint ? `<p class="hint de">${esc(c.hint)}</p>` : ""}`;
    // Rückseite: das Wort mit seinem Lautsprecher in einer Zeile (wie beim Beispielsatz)
    const back = `
      <div class="wordrow">${wordHTML(c)}${speakBtn("w", T("sayWord"))}</div>
      ${arFirst && c.hint ? `<p class="hint de">${esc(c.hint)}</p>` : ""}
      ${arLine(c.ar)}
      ${c.def ? `<p class="def de">${c.def}</p>` : ""}
      ${c.perf ? `<p class="perf de">${T("perfL")} <b>${esc(c.perf)}</b></p>` : ""}
      <div class="exrow"><p class="ex de">${c.ex}</p>${speakBtn("ex", T("sayEx"))}</div>
      ${trLine(c.tr)}
      ${noteBox(c.note)}
      ${famRow(store.relatives(c), T)}`;
    return `
      <p class="meta">${T("left").replace("{n}", L.queue.length + 1)}${isP(c) ? ` <span class="new">${T("phTag")}</span>` : ""}${s ? "" : ` <span class="new">${T("newCard")}</span>`}</p>
      <div class="card ${gClass(c)}${isP(c) ? " ph" : ""} ${L.flipped ? "flipped" : ""}" id="card" data-act="flip" role="button" tabindex="0" aria-label="${T("flip")}">
        ${c.cat ? `<p class="cat">${esc(c.cat)}</p>` : ""}
        <div class="face">${L.flipped ? back : front}</div>
        ${L.flipped ? "" : speakBtn("w", T("sayWord"))}
      </div>
      ${L.flipped
        ? `<div class="rate"><button class="btn again" data-act="no">${T("again")}</button><button class="btn ok" data-act="yes">${T("good")}</button></div>`
        : `<button class="btn wide" data-act="flip">${T("show")}</button>`}
      <p class="meta dim">${T("todayStat").replace("{d}", due).replace("{f}", fresh)}</p>`;
  }
  return {
    mode: "learn", render,
    sayCard: () => L.cur,
    actions: {
      flip: () => session.flip(),
      yes: () => session.answer(true),
      no: () => session.answer(false),
      more: () => { allowMoreNew(S.P, today(), ctx.opt("newPerDay", C.newPerDay || 10)); ctx.changed(); session.restart(); }
    },
    keys(e) {
      if (!L.cur || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); session.flip(); }
      else if (L.flipped && (e.key === "1" || e.key === "ArrowLeft")) session.answer(false);
      else if (L.flipped && (e.key === "2" || e.key === "ArrowRight")) session.answer(true);
    }
  };
}
