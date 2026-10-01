// cards.js lesen und schreiben: eine Zeile pro Karte, Anhängen ohne den Rest zu berühren (kleine Diffs in Git).
export function parseCards(src) { const w = {}; new Function("window", src)(w); return w.CARDS || []; }
export function serializeCards(head, list) { return head + "window.CARDS = [\n" + list.map(o => " " + JSON.stringify(o)).join(",\n") + "\n];\n"; }
export function appendCards(src, list) {
  const i = src.lastIndexOf("\n];");
  if (i < 0) throw new Error("format");
  return src.slice(0, i) + list.map(o => ",\n " + JSON.stringify(o)).join("") + src.slice(i);
}
export const headOf = src => src.slice(0, src.indexOf("window.CARDS"));
