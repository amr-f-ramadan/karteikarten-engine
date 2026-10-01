// Ansichten anmelden, zeichnen und Ereignisse verteilen: data-act → Aktion, Eingabefelder nach id.
import { fullWord } from "../core/text.js";
import { $, isHolding, markLoading } from "./dom.js";

export function createRouter(ctx) {
  const { S } = ctx;
  const views = {}, actions = {}, changes = {}, inputs = {};
  /* view: { mode, render, actions?, change?, input?, keys?, enter?, after?, sayCard? } */
  function register(v) { views[v.mode] = v; Object.assign(actions, v.actions || {}); Object.assign(changes, v.change || {}); Object.assign(inputs, v.input || {}); }
  const current = () => views[S.mode] || views.settings;

  function render() {
    document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-current", b.dataset.mode === S.mode ? "page" : "false"));
    const dueN = ctx.session.dueCount();
    const bd = $("#badge"); if (bd) { bd.textContent = dueN; bd.hidden = !dueN; }
    ctx.badge(dueN);
    const v = current();
    $("#main").innerHTML = v.render();
    if (v.after) v.after();
    markLoading();
    ctx.sync.setStatus(S.sync.status);
  }

  document.addEventListener("click", e => {
    const nb = e.target.closest("nav button");
    if (nb) { S.mode = nb.dataset.mode; const v = views[S.mode]; if (v && v.enter) v.enter(); render(); window.scrollTo(0, 0); return; }
    if (isHolding() && e.target.closest("#main")) { e.preventDefault(); e.stopPropagation(); return; }
    const say = e.target.closest(".say");
    if (say && say.dataset.t) { e.stopPropagation(); ctx.voice.speak(say.dataset.t, say); return; }
    if (say) { e.stopPropagation(); const v = current(), c = v.sayCard ? v.sayCard() : null; if (c) ctx.voice.speak(say.dataset.say === "ex" ? c.ex : fullWord(c), say); return; }
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act;
    if (act === "sayt") { e.stopPropagation(); ctx.voice.speak(el.dataset.t, el); return; }
    const fn = actions[act]; if (fn) fn(el, e);
  });
  document.addEventListener("change", e => { const fn = changes[e.target.id]; if (fn) fn(e.target); });
  document.addEventListener("input", e => { const fn = inputs[e.target.id]; if (fn) fn(e.target); });
  document.addEventListener("keydown", e => {
    if (isHolding() && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); return; }
    const v = current(); if (v.keys) v.keys(e);
  });
  return { register, render };
}
