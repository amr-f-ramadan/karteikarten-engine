// GitHub Contents API: Fortschritt im Branch "progress", Karten in cards.js im Branch main.
export const b64enc = s => btoa(unescape(encodeURIComponent(s)));
export const b64dec = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));

/* Liest window.CARDS aus dem Quelltext von cards.js */
export function parseCards(src) { const w = {}; new Function("window", src)(w); return w.CARDS || []; }
/* Schreibt cards.js neu, Zeile pro Karte, wie bisher */
export function serializeCards(head, list) { return head + "window.CARDS = [\n" + list.map(o => " " + JSON.stringify(o)).join(",\n") + "\n];\n"; }
/* Hängt Karten an den bestehenden Quelltext an, ohne den Rest zu berühren (kleine Diffs in Git) */
export function appendCards(src, list) {
  const i = src.lastIndexOf("\n];");
  if (i < 0) throw new Error("format");
  return src.slice(0, i) + list.map(o => ",\n " + JSON.stringify(o)).join("") + src.slice(i);
}

export function createGitHub({ repo, getToken }) {
  const base = "https://api.github.com/repos/" + repo + "/";
  const headers = () => ({ Authorization: "Bearer " + getToken(), Accept: "application/vnd.github+json" });
  let sha = null; // der letzte bekannte Stand von progress.json

  function gh(method, body) {
    return fetch(base + "contents/progress.json" + (method === "GET" ? "?ref=progress&t=" + Date.now() : ""), {
      method, cache: "no-store", keepalive: method !== "GET", headers: headers(), body: body ? JSON.stringify(body) : undefined
    });
  }
  async function pullProgress() {
    const r = await gh("GET");
    if (r.status === 404) { sha = null; return null; }
    if (!r.ok) throw new Error(r.status);
    const j = await r.json(); sha = j.sha;
    return JSON.parse(b64dec(j.content));
  }
  async function makeBranch() {
    try {
      const m = await fetch(base + "git/ref/heads/main", { headers: headers(), cache: "no-store" });
      if (!m.ok) return false;
      const r = await fetch(base + "git/refs", { method: "POST", headers: headers(), body: JSON.stringify({ ref: "refs/heads/progress", sha: (await m.json()).object.sha }) });
      return r.ok || r.status === 422;
    } catch (e) { return false; }
  }
  /* getP liefert den aktuellen Stand; bei einem Konflikt bekommt onRemote den Stand aus GitHub zum Zusammenführen */
  async function pushProgress(getP, onRemote) {
    const body = () => { const b = { message: "Fortschritt", content: b64enc(JSON.stringify(getP())), branch: "progress" }; if (sha) b.sha = sha; return b; };
    let r = await gh("PUT", body());
    if ((r.status === 404 || r.status === 422) && !sha && await makeBranch()) r = await gh("PUT", body());
    if (r.status === 409 || r.status === 422) {
      const remote = await pullProgress(); if (remote) onRemote(remote);
      r = await gh("PUT", body());
    }
    if (!r.ok) throw new Error(r.status);
    sha = (await r.json()).content.sha;
  }

  async function getFile(path, ref) {
    const r = await fetch(base + "contents/" + path + "?ref=" + ref + "&t=" + Date.now(), { headers: headers(), cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }
  const putFile = (path, body) => fetch(base + "contents/" + path, { method: "PUT", headers: headers(), body: JSON.stringify(body) });

  /* cards.js in main ändern: edit(src, taken) liefert { out, result }; bei Konflikt (jemand war schneller) ein zweiter Versuch */
  async function editCards(edit, message) {
    for (let tries = 0; tries < 2; tries++) {
      const j = await getFile("cards.js", "main"), src = b64dec(j.content);
      const { out, result } = edit(src, id => src.includes('"id":"' + id + '"'));
      const p = await putFile("cards.js", { message: message(result), content: b64enc(out), sha: j.sha, branch: "main" });
      if (p.status === 409 || p.status === 422) continue;
      if (!p.ok) throw new Error(String(p.status));
      return result;
    }
    throw new Error("409");
  }
  async function readCards() { const j = await getFile("cards.js", "main"); return parseCards(b64dec(j.content)); }

  /* Datei im Branch progress schreiben (push.json) */
  async function putProgressFile(path, obj) {
    for (let i = 0; i < 2; i++) {
      const g = await fetch(base + "contents/" + path + "?ref=progress&t=" + Date.now(), { headers: headers(), cache: "no-store" });
      const cur = g.ok ? (await g.json()).sha : null;
      const body = { message: "Erinnerung", content: b64enc(JSON.stringify(obj)), branch: "progress" }; if (cur) body.sha = cur;
      let r = await putFile(path, body);
      if ((r.status === 404 || r.status === 422) && !cur && await makeBranch()) r = await putFile(path, body);
      if (r.ok) return;
      if (r.status !== 409) throw new Error(String(r.status));
    }
    throw new Error("409");
  }

  return { pullProgress, pushProgress, hasSha: () => sha !== null, forget: () => { sha = null; }, editCards, readCards, putProgressFile };
}
