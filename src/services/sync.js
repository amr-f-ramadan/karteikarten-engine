// Fortschritt mit GitHub abgleichen: beim Start und Sichtbarwerden holen und zusammenführen, Änderungen gebündelt schicken.
import { merge } from "../core/progress.js";
import { $ } from "../ui/dom.js";

export function createSync(ctx) {
  const { S, T, github } = ctx;
  let timer = null;
  function setStatus(s) {
    S.sync.status = s;
    const el = $("#syncDot"); if (el) { el.dataset.s = s; el.title = T("st_" + s); }
    const st = $("#syncState"); if (st) st.textContent = T("st_" + s);
  }
  const key = P => JSON.stringify(P.cards) + JSON.stringify(P.art);
  async function sync(full) {
    if (!S.sync.token || S.sync.busy) return;
    S.sync.busy = true; setStatus("syncing");
    try {
      if (full || !github.hasSha()) {
        const remote = await github.pullProgress();
        if (remote) {
          const before = key(S.P);
          const m = merge(S.P, remote);
          if (key(m) + JSON.stringify(m.pending) !== key(remote) + JSON.stringify(remote.pending || {})) S.dirty = true;
          S.P = m; ctx.writeLocal();
          if (before !== key(S.P) && !S.learn.cur) ctx.session.ensureCur();
        } else S.dirty = true;
      }
      if (S.dirty) { await github.pushProgress(() => S.P, remote => { S.P = merge(S.P, remote); ctx.writeLocal(); }); S.dirty = false; }
      setStatus("ok");
    } catch (e) { const m = String(e.message); setStatus(m === "401" ? "badtoken" : m === "403" ? "noperm" : "error"); }
    S.sync.busy = false; ctx.render();
  }
  function schedule() { if (!S.sync.token) return; clearTimeout(timer); timer = setTimeout(() => sync(false), 15000); }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && S.dirty && S.sync.token) { clearTimeout(timer); sync(false); }
    if (document.visibilityState === "visible" && S.sync.token) sync(true);
  });
  return { sync, schedule, setStatus };
}
