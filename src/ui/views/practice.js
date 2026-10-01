// Sprechen üben: Gemini gibt eine Situation mit zwei gelernten Wörtern, prüft die Antwort und zeigt die Korrekturen.
import { esc, fill, fullWord, norm, pickOne } from "../../core/text.js";
import { PR_TASK, PR_FB } from "../../core/prompt.js";
import { diffHTML } from "../../core/diff.js";
import { $, hold, SLOW_MS } from "../dom.js";
import { speakBtn, famChip } from "../parts.js";

export function createPracticeView(ctx) {
  const { S, T, C, store, gemini, vocab, local, flash } = ctx;
  const PRK = local.key("practice");
  // Eine angefangene Übung bleibt beim Schließen der App erhalten
  try { const o = JSON.parse(local.get(PRK) || "null"); if (o && o.task && Array.isArray(o.words)) S.pr = Object.assign(S.pr, o); } catch (e) {}
  function save() {
    const pr = S.pr;
    if (pr.task) local.set(PRK, JSON.stringify({ words: pr.words, task: pr.task, starter: pr.starter, answer: pr.answer, fb: pr.fb })); else local.remove(PRK);
  }
  function pickWords() {
    const all = store.words, seen = all.filter(c => S.P.cards[c.id]), known = seen.filter(c => S.P.cards[c.id].b >= 1);
    const pool = known.length >= 2 ? known : seen.length >= 2 ? seen : all;
    const a = pickOne(pool), same = pool.filter(c => c !== a && c.cat && c.cat === a.cat), rest = pool.filter(c => c !== a);
    return rest.length ? [a, pickOne(same.length ? same : rest)] : [a];
  }
  const wordList = ws => ws.map(fullWord).join(", ");
  const prError = e => (e.message === "key" ? T("keyBad") : T("prFail"));
  async function prNew() {
    if (S.pr.busy) return;
    if (!S.gkey) { S.pr.msg = T("needKey"); ctx.render(); return; }
    const pr = S.pr = { words: pickWords(), task: "", starter: "", answer: "", fb: null, busy: "task", msg: "" }; hold(true, SLOW_MS); ctx.render();
    try { const t = await gemini.generate(fill(C.practice.task, { words: wordList(pr.words), topic: pr.words[0].cat || "" }), PR_TASK, o => o.task); pr.task = t.task; pr.starter = t.starter || ""; }
    catch (e) { pr.msg = prError(e); }
    pr.busy = false; save(); hold(false); ctx.render();
  }
  async function prCheck() {
    const pr = S.pr, el = $("#pa"); if (el) pr.answer = el.value.trim();
    if (!pr.answer || pr.busy) return;
    pr.busy = "check"; pr.msg = ""; hold(true, SLOW_MS); ctx.render();
    try { pr.fb = await gemini.generate(fill(C.practice.feedback, { words: wordList(pr.words), task: pr.task, answer: pr.answer }), PR_FB, o => o.natural); }
    catch (e) { pr.msg = prError(e); }
    pr.busy = false; save(); hold(false); ctx.render();
  }
  function render() {
    const pr = S.pr, intro = `<p class="meta">${T("prIntro")}</p>`, msg = pr.msg ? `<p class="addmsg">${esc(pr.msg)}</p>` : "";
    if (!pr.task) return `${intro}<div class="card pr">${msg}<button class="btn ok wide" data-act="prnew" ${pr.busy ? "disabled" : ""}>${pr.busy ? T("prBusy") : T("prStart")}</button></div>`;
    const f = pr.fb, used = f ? (f.used || []).map(norm) : [], kinds = new Set();
    const isUsed = c => used.some(u => u && (u.includes(norm(c.w)) || norm(c.w).includes(u)));
    return `${intro}<div class="card pr">
      <p class="prh">${T("prWords")}</p><div class="famrow">${pr.words.map(famChip).join("")}</div>
      <p class="prtask" dir="auto">${esc(pr.task)}</p>
      ${pr.starter ? `<p class="hint de">${esc(pr.starter)} …</p>` : ""}
      <textarea id="pa" class="prin" rows="3" dir="auto" autocapitalize="sentences" placeholder="${esc(T("prPh"))}" ${f ? "readonly" : ""}>${esc(pr.answer)}</textarea>
      ${msg}
      ${f ? `<div class="prfb">
        <p class="prh">${f.correct ? T("prGood") : T("prCorrected")}</p><p class="de prde" dir="ltr">${diffHTML(pr.answer, f.corrected || pr.answer, f.edits, kinds)}</p>
        ${kinds.size ? `<p class="prkey">${kinds.has("err") ? `<span class="err">${T("prErr")}</span>` : ""}${kinds.has("sty") ? `<span class="sty">${T("prSty")}</span>` : ""}</p>` : ""}
        <p class="prh">${T("prNatural")}</p><div class="exrow"><p class="ex de">${esc(f.natural)}</p>${speakBtn("", T("sayEx")).replace('data-say=""', `data-t="${esc(f.natural)}"`)}</div>
        ${(f.tips || []).length ? `<p class="prh">${T("prTips")}</p><ul class="prtips">${f.tips.map(t => `<li dir="auto">${esc(t)}</li>`).join("")}</ul>` : ""}
        <p class="prh">${T("prUsed")}</p><p class="prused de">${pr.words.map(c => `<span class="${isUsed(c) ? "yes" : "no"}">${isUsed(c) ? "✓" : "✗"} ${esc(fullWord(c))}</span>`).join(" ")}</p>
        ${(f.chunks || []).length ? `<p class="prh">${T("prChunks")}</p><div class="wait">${f.chunks.map(t => `<span class="chip de">${esc(t)}<button data-act="pradd" data-t="${esc(t)}" aria-label="${esc(T("prAdd"))}">+</button></span>`).join("")}</div>` : ""}
      </div>
      <button class="btn ok wide" data-act="prnew">${T("prNext")}</button>`
      : `<button class="btn ok wide" data-act="prcheck" ${pr.busy ? "disabled" : ""}>${pr.busy ? T("prBusy") : T("prCheck")}</button>`}
    </div>`;
  }
  return {
    mode: "practice", render,
    actions: {
      prnew: prNew, prcheck: prCheck,
      pradd: el => { vocab.queueWord(el.dataset.t, C.phrases ? "p" : undefined); flash(T("prAdded")); el.disabled = true; setTimeout(vocab.workQueue, 500); }
    },
    input: { pa: el => { S.pr.answer = el.value; save(); } }
  };
}
