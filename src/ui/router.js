// Ansichten anmelden, zeichnen und Ereignisse verteilen: data-act → Aktion, Eingabefelder nach id.
import { fullWord } from "../core/text.js";
import { $, isHolding, markLoading } from "./dom.js";

export function createRouter(ctx) {
  const { S } = ctx;
  const views = {}, actions = {}, changes = {}, inputs = {}, parts = [];
  /* view: { mode, render, actions?, change?, input?, keys?, enter?, after?, sayCard? } */
  function register(v) { views[v.mode] = v; Object.assign(actions, v.actions || {}); Object.assign(changes, v.change || {}); Object.assign(inputs, v.input || {}); }
  /* part: ein Stück Oberfläche außerhalb der Ansichten (das Eingabeblatt), mit Aktionen, Eingaben, Tasten; zeichnet sich nach jeder Ansicht */
  function registerPart(p) { parts.push(p); Object.assign(actions, p.actions || {}); Object.assign(changes, p.change || {}); Object.assign(inputs, p.input || {}); }
  const current = () => views[S.mode] || views.settings;

  function render() {
    const st = ctx.session.count(), dueN = st.due + st.fresh;
    ctx.dock.refresh(dueN);
    ctx.badge(dueN);
    const v = current();
    $("#main").innerHTML = v.render();
    if (v.after) v.after();
    parts.forEach(p => p.render());
    markLoading();
    ctx.sync.setStatus(S.sync.status);
  }

  /* Ansicht wechseln: der eine Weg für Tab-Leiste und Dock */
  function go(mode) {
    S.mode = mode; const v = views[mode]; if (v && v.enter) v.enter();
    render(); window.scrollTo(0, 0);
  }

  document.addEventListener("click", e => {
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
    for (const p of parts) if (p.keys && p.keys(e)) return; // ein Teil, der die Taste nimmt, lässt sie nicht an die Ansicht
    const v = current(); if (v.keys) v.keys(e);
  });
  return { register, registerPart, render, go };
}
