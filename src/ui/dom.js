// Kleine DOM-Helfer: Auswahl, Hinweis-Toast, Sperre während langsamer Arbeit, Ladering am Lautsprecher.
export const $ = s => document.querySelector(s);
export const calm = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
export function plain(h) { const d = document.createElement("div"); d.innerHTML = h; return d.textContent.replace(/…/g, "").trim(); }
export function flash(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(() => (el.hidden = true), 2600); }

/* Während etwas Langsames läuft (z. B. eine neue Aussprache), sind die Knöpfe gesperrt: bis zum Ergebnis, höchstens ms */
export const HOLD_MS = 12000;
export const SLOW_MS = 30000; // Gemini-Text (Karten, Übungen) braucht länger als eine Aussprache
let holding = false, holdT = null;
export function hold(on, ms) {
  holding = on; document.body.classList.toggle("hold", on); clearTimeout(holdT);
  if (on) holdT = setTimeout(() => hold(false), ms || HOLD_MS);
}
export const isHolding = () => holding;

/* Ring um den Lautsprecher, solange eine neue Aussprache erzeugt wird (bleibt auch nach einem Neuzeichnen) */
let loadSel = null;
const btnSel = b => !b ? null : b.dataset.t !== undefined ? `[data-t="${CSS.escape(b.dataset.t)}"]` : b.dataset.say ? `#card .say[data-say="${b.dataset.say}"]` : null;
export function markLoading() { if (loadSel) document.querySelectorAll(loadSel).forEach(b => { b.classList.add("loading"); b.setAttribute("aria-busy", "true"); }); }
export function setLoading(btn) { loadSel = btnSel(btn); markLoading(); }
export function stopLoading() { loadSel = null; document.querySelectorAll(".loading").forEach(b => { b.classList.remove("loading"); b.removeAttribute("aria-busy"); }); }
