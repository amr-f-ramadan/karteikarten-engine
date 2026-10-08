// Lernen: Vorderseite (Wort oder, bei bekannten Karten, erst die Bedeutung), Rückseite mit allem, Nochmal/Gewusst.
import { esc, today, isP } from "../../core/text.js";
import { dueByTomorrow, allowMoreNew } from "../../core/leitner.js";
import { gClass } from "../../core/text.js";
import { faceOf } from "../../core/newcard.js";
import { $, calm } from "../dom.js";
import { speakBtn, wordHTML, famRow, trLine, noteBox, meaningLines, meaningBig, meaningMode, synRow, formsRow } from "../parts.js";

export function createLearnView(ctx) {
  const { S, T, C, store, session } = ctx, L = S.learn;
  function render() {
    const { due, fresh } = session.stats;
    if (!L.cur) {
      return `<div class="done"><p class="big">${T("doneTitle")}</p><p>${T("doneText").replace("{n}", dueByTomorrow(store.all, S.P))}</p>
        <button class="btn" data-act="more">${T("moreNew")}</button></div>`;
    }
    // Die Vorderseite zeigt die gelernte Seite (Basis oder Wortform); Bedeutung zuerst schon ab Kasten 1, damit das Abrufen oft geübt wird
    const c = L.cur, s = S.P.cards[c.id], always = ctx.opt("arFirst", false), face = faceOf(c, L.face);
    const arFirst = always || (ctx.opt("prodAuto", true) && !!s && s.b >= 1);
    const front = arFirst
      ? `${meaningBig(face, meaningMode(ctx))}<p class="hint">${T(always ? "whatDe" : isP(c) ? "sayPh" : "sayDe")}</p>${calm() ? "" : '<div class="timer"></div>'}`
      : `${wordHTML(face)}${face.hint ? `<p class="hint de">${esc(face.hint)}</p>` : ""}`;
    // Rückseite: das Wort mit seinem Lautsprecher in einer Zeile (wie beim Beispielsatz)
    const back = `
      <div class="wordrow">${wordHTML(c)}${speakBtn("w", T("sayWord"))}</div>
      ${arFirst && c.hint ? `<p class="hint de">${esc(c.hint)}</p>` : ""}
      ${meaningLines(c, meaningMode(ctx))}
      ${c.def ? `<p class="def de">${c.def}</p>` : ""}
      ${c.perf ? `<p class="perf de">${T("perfL")} <b>${esc(c.perf)}</b></p>` : ""}
      <div class="exrow"><p class="ex de">${c.ex}</p>${speakBtn("ex", T("sayEx"))}</div>
      ${trLine(c.tr)}
      ${noteBox(c.note)}
      ${formsRow(c, L.face, T, meaningMode(ctx))}
      ${synRow(c, store, T, "sayt")}
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
  /* Läuft der Balken ab, dreht sich die Karte von selbst um; gezählt wird erst mit Nochmal/Gewusst. Der Balken selbst gibt
     den Takt (sein Ende ist das Ereignis), darum gibt es ohne Balken (bewegungsarm) auch kein Umdrehen */
  function after() {
    const bar = $("#card .timer");
    if (bar) bar.addEventListener("animationend", () => session.flip(), { once: true });
  }
  return {
    mode: "learn", render, after,
    sayCard: () => (L.cur && !L.flipped ? faceOf(L.cur, L.face) : L.cur), // vorn spricht der Lautsprecher die gezeigte Seite
    actions: {
      flip: () => session.flip(),
      yes: () => session.answer(true),
      no: () => session.answer(false),
      more: () => { allowMoreNew(S.P, today(), ctx.opt("newPerDay", C.newPerDay || 10)); ctx.changed(); session.restart(); }
    },
    keys(e) {
      if (!L.cur || /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) return; // ein Knopf mit Fokus bekommt Enter und Leertaste selbst
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); session.flip(); }
      else if (L.flipped && (e.key === "1" || e.key === "ArrowLeft")) session.answer(false);
      else if (L.flipped && (e.key === "2" || e.key === "ArrowRight")) session.answer(true);
    }
  };
}
