// Veränderlicher Zustand der laufenden App an einer Stelle. Dauerhaftes steht in P (Fortschritt) und localStorage.
export function createState(P) {
  return {
    P, dirty: false,
    sync: { token: "", status: "local", busy: false },
    gkey: "",
    mode: "learn",
    learn: { queue: [], cur: null, flipped: false, turning: false },
    quiz: null,
    list: { open: null, kind: "w", query: "" },
    add: { word: "", busy: false, card: null, msg: "" },
    pad: { word: "", busy: false, card: null, msg: "" },
    pr: { words: [], task: "", starter: "", answer: "", fb: null, busy: false, msg: "" }
  };
}
export const emptyAdd = () => ({ word: "", busy: false, card: null, msg: "" });
