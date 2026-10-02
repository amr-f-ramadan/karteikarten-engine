// Dock: die Tab-Leiste ist eine Pille hinter einem runden Knopf in der Ecke. Der Knopf zeigt die aktuelle Ansicht und die
// fälligen Karten; ein Tipp fährt ihn in die Mitte und lässt die Pille aus ihm wachsen, Wischen dreht die Ansichten ohne
// Ende, ein Tipp wählt, danach fällt die Pille in den Knopf zurück. Waagerecht (unten) oder senkrecht (rechts, Option
// dockV). Die Apps liefern nur ihre nav-Knöpfe (Symbol, Text, #badge).
import { nearestTurn, settleTarget, glideDuration } from "../core/dock.js";
import { calm } from "./dom.js";

// MOVE_MS: der Weg des Knopfs zwischen Ecke und Mitte, RISE_MS: das Wachsen, SINK_MS: das Fallen der Pille (alle wie in app.css)
const SLOT = 76, TAP_PX = 6, IDLE_MS = 3500, MOVE_MS = 600, RISE_MS = 700, SINK_MS = 700;

export function createDock(ctx, nav) {
  const { S } = ctx;
  const items = [...nav.querySelectorAll("button[data-mode]")], N = items.length;
  if (!N) return { refresh() {} };
  // Der Text in den Knöpfen der Apps ist nackt; nur der mittlere Knopf zeigt ihn, dafür braucht er ein Element
  items.forEach(b => [...b.childNodes].forEach(n => {
    if (n.nodeType !== 3 || !n.textContent.trim()) return;
    const s = document.createElement("span"); s.className = "lbl"; s.textContent = n.textContent.trim(); b.replaceChild(s, n);
  }));
  const knob = document.createElement("button");
  knob.className = "knob"; knob.setAttribute("aria-expanded", "false");
  knob.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"></svg><span class="kbadge" id="kbadge" hidden></span>';
  knob.setAttribute("aria-describedby", "kbadge"); // aria-label verdeckt den Inhalt: die Zahl wird so trotzdem vorgelesen
  nav.after(knob); nav.setAttribute("aria-hidden", "true");
  // Geschlossen ist die Pille unsichtbar: ihre Knöpfe dürfen dann nicht per Tab erreichbar sein
  const setTabs = open => items.forEach(b => { b.tabIndex = open ? 0 : -1; });
  setTabs(false);

  const mod = i => ((i % N) + N) % N;
  // Senkrecht läuft die Reihe von oben nach unten, in beiden Schreibrichtungen; waagerecht ist sie in RTL gespiegelt
  const isV = () => document.body.classList.contains("dock-v");
  const dir = () => (!isV() && getComputedStyle(nav).direction === "rtl" ? -1 : 1);
  const axis = e => (isV() ? e.clientY : e.clientX);
  const current = () => Math.max(0, items.findIndex(b => b.dataset.mode === S.mode));
  let pos = current(), anim = null, idleT = null, closeT = null, moveT = null, backT = null, riseT = null;
  let active = false, startX = 0, startPos = 0, moved = false, lastX = 0, lastT = 0, vel = 0, lastRelease = 0;

  /* Symbol, Größe und Text folgen dem Abstand zur Mitte, damit beim Gleiten nichts springt: der mittlere Knopf hebt sein
     Symbol an (senkrecht: rückt es nach innen) und zeigt seinen Text, die anderen sitzen in der Mitte der Pille */
  function place() {
    const on = mod(Math.round(pos)), v = isV();
    items.forEach((b, i) => {
      const d = nearestTurn(i - pos, N), near = Math.max(0, 1 - Math.abs(d)), s = Math.max(0.8, 1.25 - Math.abs(d) * 0.35);
      const along = (d * SLOT * dir()).toFixed(1), lift = (-9 * near).toFixed(1);
      b.style.transform = `translate(${v ? lift : along}px, ${v ? along : lift}px) scale(${s.toFixed(3)})`;
      b.style.opacity = Math.abs(d) > 2.6 ? 0 : 1;
      const lbl = b.querySelector(".lbl"); if (lbl) lbl.style.opacity = Math.max(0, 2 * near - 1).toFixed(2);
      b.classList.toggle("on", i === on);
    });
  }
  const stopGlide = () => { if (anim) cancelAnimationFrame(anim); anim = null; };
  /* Nach dem Loslassen gleitet die Reihe Bild für Bild, dieselbe Bewegung wie beim Wischen: nichts springt */
  function glideTo(target, done) {
    stopGlide();
    const from = pos, dist = target - from, dur = glideDuration(dist), t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      pos = from + dist * (1 - Math.pow(1 - k, 3)); place();
      if (k < 1) anim = requestAnimationFrame(step); else { anim = null; pos = target; place(); if (done) done(); }
    };
    anim = requestAnimationFrame(step);
  }
  const idle = () => { clearTimeout(idleT); idleT = setTimeout(() => setOpen(false), IDLE_MS); };
  function setOpen(open) {
    clearTimeout(idleT); clearTimeout(closeT);
    nav.classList.toggle("open", open); nav.setAttribute("aria-hidden", String(!open));
    knob.setAttribute("aria-expanded", String(open)); document.body.classList.toggle("dock-open", open);
    setTabs(open);
    if (open) {
      stopGlide(); pos = current();
      /* Der mittlere Knopf beginnt wie der Knopf aussah (Symbol unten, kein Text) und wächst mit der Pille in seine Form;
         zuerst ohne Übergang in den Anfangszustand, erst dann (nach einem Layout) mit Übergang ans Ziel */
      const cur = items[current()], lbl = cur.querySelector(".lbl");
      nav.classList.remove("rising"); cur.style.transform = "translate(0px, 0px) scale(1)"; if (lbl) lbl.style.opacity = "0";
      void nav.offsetWidth; nav.classList.add("rising"); clearTimeout(riseT); riseT = setTimeout(() => nav.classList.remove("rising"), RISE_MS);
      place(); cur.focus({ preventScroll: true }); idle();
    } else {
      if (nav.contains(document.activeElement)) knob.focus({ preventScroll: true });
      // Der Text verschwindet sofort, sonst stünde er noch unter dem Symbol, während die Pille in den Knopf fällt
      items.forEach(b => { const l = b.querySelector(".lbl"); if (l) l.style.opacity = "0"; });
      // Erst sinkt die Pille, dann fährt der Knopf zurück in seine Ecke
      clearTimeout(backT); backT = setTimeout(() => knob.classList.remove("mid"), calm() ? 0 : SINK_MS);
    }
  }
  /* Ein Tipp auf den Knopf in der Ecke: er fährt in die Mitte, dort steigt die Pille auf; unterwegs zählt kein zweiter Tipp */
  function summon() {
    if (moveT) return;
    clearTimeout(backT); knob.classList.add("mid");
    moveT = setTimeout(() => { moveT = null; setOpen(true); }, calm() ? 0 : MOVE_MS);
  }
  /* Erst landet die Reihe, dann wechselt die Ansicht; die Pille bleibt noch die Ruhezeit oben und sinkt dann */
  function pick(target) {
    clearTimeout(idleT); clearTimeout(closeT);
    glideTo(target, () => { ctx.go(items[mod(target)].dataset.mode); closeT = setTimeout(() => setOpen(false), IDLE_MS); });
  }

  nav.addEventListener("pointerdown", e => {
    stopGlide(); nav.classList.remove("rising"); active = true; moved = false; vel = 0;
    try { nav.setPointerCapture(e.pointerId); } catch (x) {}
    startX = lastX = axis(e); startPos = pos; lastT = performance.now(); idle();
  });
  nav.addEventListener("pointermove", e => {
    if (!active) return;
    const x = axis(e), dx = x - startX, now = performance.now();
    if (Math.abs(dx) > TAP_PX) moved = true;
    if (now > lastT) vel = (x - lastX) / (now - lastT);
    lastX = x; lastT = now;
    pos = startPos - dx * dir() / SLOT; place();
  });
  // Der ganzzahlige Platz, an dem ein Knopf an seiner nächsten Runde liegt (pos kann mitten im Gleiten gebrochen sein)
  const slotOf = b => Math.round(pos + nearestTurn(items.indexOf(b) - pos, N));
  // Mit Pointer Capture landen alle Ereignisse auf der nav, darum wird der getippte Knopf unter dem Finger gesucht
  const itemAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY), b = el && el.closest("button[data-mode]"); return b && items.includes(b) ? b : null; };
  /* Auch ein abgebrochener Touch (der Browser nahm die Geste) landet auf einem Symbol, nie dazwischen */
  function release(e) {
    if (!active) return; active = false; lastRelease = performance.now();
    // Kein Schnipp nach einer Pause vor dem Loslassen, und keiner, wenn der Browser die Geste abgebrochen hat
    if (e.type !== "pointerup" || lastRelease - lastT > 80) vel = 0;
    const tapped = !moved && e.type === "pointerup" ? itemAt(e) : null;
    if (tapped) pick(slotOf(tapped));
    else pick(settleTarget(pos, vel, 1 / SLOT, dir()));
  }
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(t => nav.addEventListener(t, release));
  /* Tastatur (Enter auf einem Knopf) und ein Touch, den der Browser anders beendet: der Klick wählt trotzdem */
  nav.addEventListener("click", e => {
    if (performance.now() - lastRelease < 120) return;
    const b = e.target.closest("button[data-mode]"); if (!b) return;
    active = false; pick(slotOf(b));
  });
  /* Pfeiltasten drehen die Reihe (waagerecht in RTL gespiegelt, senkrecht auch mit Auf und Ab), Escape schließt */
  nav.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: isV() ? 1 : 0, ArrowUp: isV() ? -1 : 0 }[e.key];
    if (!step) return;
    e.preventDefault(); stopGlide(); idle();
    const target = Math.round(pos) + step * dir();
    glideTo(target); items[mod(target)].focus({ preventScroll: true });
  });
  knob.addEventListener("click", summon);

  /* Nach jedem Zeichnen: aktive Ansicht markieren, Zahl in Leiste und Knopf, Symbol und Name der Ansicht auf dem Knopf */
  function refresh(dueN) {
    // Die Ausrichtung ist eine Option (Aussehen): die Klasse am body schaltet CSS und Achse um
    const v = !!ctx.opt("dockV", false); if (v !== isV()) { document.body.classList.toggle("dock-v", v); place(); }
    const cur = items[current()];
    items.forEach(b => b.setAttribute("aria-current", b === cur ? "page" : "false"));
    const bd = document.getElementById("badge"); if (bd) { bd.textContent = dueN; bd.hidden = !dueN; }
    // Die Zahl gehört zum Lernen-Knopf (dem mit #badge): der Knopf zeigt sie nur, solange er diese Ansicht zeigt
    const kb = knob.querySelector(".kbadge"); kb.textContent = dueN; kb.hidden = !dueN || !cur.contains(bd);
    const svg = cur.querySelector("svg"); if (svg) knob.replaceChild(svg.cloneNode(true), knob.querySelector("svg"));
    const lbl = cur.querySelector(".lbl"); knob.setAttribute("aria-label", lbl ? lbl.textContent : cur.dataset.mode);
  }
  place();
  return { refresh };
}
