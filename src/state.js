// Veränderlicher Zustand der laufenden App an einer Stelle. Dauerhaftes steht in P (Fortschritt) und localStorage.
export function createState(P) {
  return {
    P, dirty: false,
    sync: { token: "", status: "local", busy: false },
    gkey: "",
    mode: "learn",
    learn: { queue: [], cur: null, flipped: false, turning: false },
    quiz: null, asked: [], // die zuletzt gefragten Nomen (ids), damit das Quiz sie nicht gleich wieder zeigt
    list: { open: null, query: "", closed: { w: null, p: null } }, // Wörter- und Wendungsliste: offene Zeile, Suche, zugeklappte Themen je Art
    add: { word: "", busy: false, card: null, msg: "" },
    fill: { busy: false }, // englische Bedeutungen werden gerade nachgetragen
    pad: { word: "", busy: false, card: null, msg: "" },
    pr: { words: [], task: "", starter: "", answer: "", fb: null, busy: false, msg: "" }
  };
}
export const emptyAdd = () => ({ word: "", busy: false, card: null, msg: "" });
