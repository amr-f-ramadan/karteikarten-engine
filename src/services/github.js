// GitHub Contents API: Fortschritt im Branch "progress", Karten in cards.js im Branch main.
export const b64enc = s => btoa(unescape(encodeURIComponent(s)));
export const b64dec = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));

export { parseCards, serializeCards, appendCards, headOf } from "../core/cardsfile.js";
import { parseCards } from "../core/cardsfile.js";

export function createGitHub({ repo, getToken }) {
  const base = "https://api.github.com/repos/" + repo + "/";
  const headers = () => ({ Authorization: "Bearer " + getToken(), Accept: "application/vnd.github+json" });
  let sha = null; // der letzte bekannte Stand von progress.json

  /* Dateien lesen mit ETag: unverändert antwortet GitHub mit 304 ohne Inhalt, das zählt nicht zum Limit */
  const cache = new Map();
  async function fetchFile(path, ref) {
    const k = path + "@" + ref, c = cache.get(k), h = headers();
    if (c) h["If-None-Match"] = c.etag;
    const r = await fetch(base + "contents/" + path + "?ref=" + ref + "&t=" + Date.now(), { headers: h, cache: "no-store" });
    if (r.status === 304 && c) return { status: 200, json: c.json, same: true };
    if (!r.ok) { if (r.status === 404) cache.delete(k); return { status: r.status, json: null, same: false }; }
    const json = await r.json(), etag = r.headers.get("ETag");
    if (etag) cache.set(k, { etag, json }); else cache.delete(k);
    return { status: 200, json, same: false };
  }
  const putFile = (path, body, extra) => fetch(base + "contents/" + path, Object.assign({ method: "PUT", headers: headers(), body: JSON.stringify(body) }, extra));

  async function pullProgress() {
    const f = await fetchFile("progress.json", "progress");
    if (f.status === 404) { sha = null; return null; }
    if (f.status !== 200) throw new Error(f.status);
    sha = f.json.sha;
    return JSON.parse(b64dec(f.json.content));
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
    const put = () => putFile("progress.json", body(), { cache: "no-store", keepalive: true });
    let r = await put();
    if ((r.status === 404 || r.status === 422) && !sha && await makeBranch()) r = await put();
    if (r.status === 409 || r.status === 422) {
      const remote = await pullProgress(); if (remote) onRemote(remote);
      r = await put();
    }
    if (!r.ok) throw new Error(r.status);
    sha = (await r.json()).content.sha;
  }

  async function getFile(path, ref) {
    const f = await fetchFile(path, ref);
    if (f.status !== 200) throw new Error(String(f.status));
    return f.json;
  }

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
  /* null, wenn cards.js seit dem letzten Lesen unverändert ist */
  async function readCards() {
    const f = await fetchFile("cards.js", "main");
    if (f.status !== 200) throw new Error(String(f.status));
    return f.same ? null : parseCards(b64dec(f.json.content));
  }

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
