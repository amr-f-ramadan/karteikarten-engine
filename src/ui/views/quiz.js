// Artikel-Quiz: Nomen, die oft falsch waren, kommen häufiger; nach der Antwort wird das Wort gesprochen.
import { esc, ART, fullWord, gClass } from "../../core/text.js";
import { $ } from "../dom.js";
import { sayT, arLine } from "../parts.js";

export function createQuizView(ctx) {
  const { S, T, store, voice } = ctx;
  function pick() {
    const nouns = store.nouns;
    if (!nouns.length) { S.quiz = null; return; }
    const w = nouns.map(c => { const a = S.P.art[c.id]; return 1 + (a ? a.w * 3 - a.ok * 0.5 : 2); }).map(x => Math.max(0.3, x));
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while (r > w[i]) { r -= w[i]; i++; }
    const c = nouns[Math.min(i, nouns.length - 1)];
    S.quiz = { c: S.quiz && S.quiz.c === c && nouns.length > 1 ? nouns[(i + 1) % nouns.length] : c, picked: null };
  }
  function answer(g) {
    const q = S.quiz;
    if (q.picked) return;
    q.picked = g;
    const id = q.c.id, a = S.P.art[id] || { ok: 0, w: 0, t: 0 };
    if (g === q.c.g) a.ok++; else a.w++;
    a.t = Date.now(); S.P.art[id] = a; ctx.changed();
    ctx.render();
    voice.speak(ART[q.c.g] + " " + q.c.w, $(".card.quiz .say"));
  }
  function render() {
    if (!S.quiz) pick();
    if (!S.quiz) return `<div class="done"><p>${T("noNouns")}</p></div>`;
    const q = S.quiz, c = q.c, a = S.P.art[c.id];
    const opts = ["der", "die", "das"].map(g => {
      let cls = "btn art-" + g;
      if (q.picked) { if (g === c.g) cls += " right"; else if (g === q.picked) cls += " wrong"; else cls += " fade"; }
      return `<button class="${cls}" data-act="art" data-g="${g}">${g}</button>`;
    }).join("");
    return `
      <p class="meta">${T("artQ")}</p>
      <div class="card quiz ${q.picked ? gClass(c) : ""}">
        <div class="face"><span class="de word">${q.picked ? `<span class="art">${ART[c.g]}</span> ` : "<span class=\"blank\">___</span> "}${esc(c.w)}</span>
        ${q.picked ? arLine(c.ar) : ""}</div>
        ${q.picked ? sayT(fullWord(c), T("sayWord")) : ""}
      </div>
      <div class="arts">${opts}</div>
      ${q.picked ? `<button class="btn wide" data-act="nextq">${T("next")}</button>` : ""}
      <p class="meta dim">${a ? T("artStat").replace("{ok}", a.ok).replace("{w}", a.w) : ""}</p>`;
  }
  return {
    mode: "quiz", render,
    enter() { if (!S.quiz) pick(); },
    sayCard: () => S.quiz && S.quiz.c,
    actions: { art: el => answer(el.dataset.g), nextq: () => { pick(); ctx.render(); } }
  };
}
