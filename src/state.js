// Veränderlicher Zustand der laufenden App an einer Stelle. Dauerhaftes steht in P (Fortschritt) und localStorage.
export function createState(P) {
  return {
    P, dirty: false,
    sync: { token: "", status: "local", busy: false },
    gkey: "",
    mode: "learn",
    learn: { queue: [], cur: null, face: 0, flipped: false, turning: false }, // face: 0 die Basis, sonst die Wortform (Index + 1)
    quiz: null, asked: [], // die zuletzt gefragten Nomen (ids), damit das Quiz sie nicht gleich wieder zeigt
    list: { open: null, query: "", closed: { w: null, p: null } }, // Wörter- und Wendungsliste: offene Zeile, Suche, zugeklappte Themen je Art
    add: { open: false, word: "", busy: false, card: null, msg: "" }, // das Eingabeblatt hinter dem Plus: Entwurf, Vorschau (card.kind w oder p)
    fill: { busy: false }, // Karten werden gerade ergänzt
    pad: { word: "", busy: false, card: null, msg: "" },
    pr: { words: [], task: "", starter: "", answer: "", fb: null, busy: false, msg: "" }
  };
}
export const emptyAdd = () => ({ open: false, word: "", busy: false, card: null, msg: "" });
