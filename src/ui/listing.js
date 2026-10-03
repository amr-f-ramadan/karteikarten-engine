// Was Wörter- und Wendungsliste teilen: ab COLLAPSE_AT Zeilen sind die Themen einklappbar und zunächst bis auf das erste zu;
// die Suche zeigt Treffer immer. S.list hält open, query und die zugeklappten Themen je Art (w, p).
import { norm } from "../core/text.js";
import { $ } from "./dom.js";

export const COLLAPSE_AT = 150;

export function closedSet(S, kind, titles) {
  const c = S.list.closed;
  if (c[kind] === null && titles.length > 1) c[kind] = new Set(titles.slice(1));
  return c[kind];
}

export function applyFilter(S, kind) {
  const q = norm(S.list.query).trim(), closed = S.list.closed[kind];
  let any = false;
  document.querySelectorAll(".topic").forEach(sec => {
    let n = 0;
    sec.querySelectorAll("li").forEach(li => { const hit = !q || li.dataset.s.includes(q); li.hidden = !hit; if (hit) n++; });
    sec.hidden = !n; if (n) any = true;
    if (closed) sec.classList.toggle("closed", !q && closed.has(sec.dataset.topic));
    const cnt = sec.querySelector(".tcount"); if (cnt) cnt.textContent = n;
  });
  const nh = $("#nohits"); if (nh) nh.hidden = any;
}

/* Die Aktionen, die beide Listen gleich haben: Zeile auf- und zuklappen, Thema ein- und ausklappen, Suche. Der Router kennt
   jede Aktion nur einmal (beide Ansichten melden dieselben Namen), darum folgt die Art der gerade gezeigten Ansicht */
export const kindOf = S => (S.mode === "phrases" ? "p" : "w");
export function listActions(ctx) {
  const { S } = ctx;
  return {
    actions: {
      open: el => { S.list.open = S.list.open === el.dataset.id ? null : el.dataset.id; ctx.render(); },
      /* Ein Synonym, das in der Liste ist: seine Zeile öffnen und hinscrollen */
      goto: el => { S.list.open = el.dataset.id; ctx.render(); const row = document.querySelector(`.row[data-id="${el.dataset.id}"]`); if (row) row.scrollIntoView({ block: "center" }); },
      topic: el => { const sec = el.closest(".topic"), c = S.list.closed[kindOf(S)]; if (!sec || !c) return; const t = sec.dataset.topic; if (c.has(t)) c.delete(t); else c.add(t); sec.classList.toggle("closed", c.has(t)); }
    },
    input: { q: el => { S.list.query = el.value; applyFilter(S, kindOf(S)); } },
    enter() { S.list.open = null; S.list.query = ""; },
    after() { if (S.list.query) applyFilter(S, kindOf(S)); }
  };
}
