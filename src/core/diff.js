// Korrekturen sichtbar machen: Antwort und korrigierte Fassung Wort für Wort vergleichen (auf dem Gerät, ohne Gemini).
// Falsches durchgestrichen, Richtiges direkt dahinter hervorgehoben; Geminis Liste "edits" sagt, ob Fehler oder nur Stil.
import { esc } from "./text.js";

export function tokens(t) {
  const out = [], re = /[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}]/gu;
  let m, last = 0;
  while ((m = re.exec(t))) { out.push({ t: m[0], sp: m.index > last || (m.index > 0 && /\s/.test(t[m.index - 1])) }); last = m.index + m[0].length; }
  if (out.length) out[0].sp = false;
  return out;
}

/* kinds sammelt die vorkommenden Arten ("err", "sty") für die Legende */
export function diffHTML(a, b, edits, kinds = new Set()) {
  const x = tokens(a), y = tokens(b), n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i].t === y[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i].t === y[j].t) { ops.push(["=", y[j]]); i++; j++; }
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) ops.push(["+", y[j++]]);
    else ops.push(["-", x[i++]]);
  }
  // Gelöschtes vor Eingefügtes, damit „falsch → richtig“ nebeneinander steht
  for (let k = 0; k < ops.length; k++) {
    let e = k; while (e < ops.length && ops[e][0] !== "=") e++;
    if (e - k > 1) { const run = ops.slice(k, e); ops.splice(k, e - k, ...run.filter(o => o[0] === "-"), ...run.filter(o => o[0] === "+")); }
    k = e;
  }
  const sp = (tk, k) => (k > 0 && tk.sp ? " " : "");
  const join = list => list.map((o, i) => (i ? sp(o[1], 1) : "") + o[1].t).join("");
  const key = t => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const hit = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));
  const kindOf = (del, ins) => {
    const d = key(del), n = key(ins);
    const e = (edits || []).find(x => (d && hit(key(x.wrong), d)) || (n && hit(key(x.right), n)));
    return e && e.kind === "style" ? "sty" : "err";
  };
  let html = "", k = 0;
  while (k < ops.length) {
    const lead = sp(ops[k][1], k);
    if (ops[k][0] === "=") {
      let e = k; while (e < ops.length && ops[e][0] === "=") e++;
      html += lead + esc(join(ops.slice(k, e))); k = e; continue;
    }
    let e = k; while (e < ops.length && ops[e][0] !== "=") e++;
    const run = ops.slice(k, e), dels = run.filter(o => o[0] === "-"), inss = run.filter(o => o[0] === "+");
    const base = kindOf(join(dels), join(inss));
    // jedes Wort einzeln zuordnen, damit Fehler und Verbesserung nebeneinander verschieden aussehen
    const wordKind = (t, field) => { const w = key(t); if (!w) return base; const x = (edits || []).find(z => key(z[field]).split(" ").includes(w)); return x ? (x.kind === "style" ? "sty" : "err") : base; };
    const part = (list, tag, field) => {
      let out = "", i = 0;
      while (i < list.length) {
        const c = wordKind(list[i][1].t, field); let j = i; while (j < list.length && wordKind(list[j][1].t, field) === c) j++;
        kinds.add(c); out += (i ? (list[i][1].sp ? " " : "") : "") + `<${tag} class="${c}">${esc(join(list.slice(i, j)))}</${tag}>`; i = j;
      }
      return out;
    };
    html += lead + part(dels, "del", "wrong") + (dels.length && inss.length ? (inss[0][1].sp ? " " : "") : "") + part(inss, "ins", "right");
    k = e;
  }
  return html;
}
