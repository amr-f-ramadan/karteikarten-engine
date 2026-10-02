// Einstieg: Einstellungen der App (window.APP) und Karten (window.CARDS) nehmen, Dienste verdrahten, erste Ansicht zeichnen.
import { emptyP, optOf, prune } from "./core/progress.js";
import { CardStore } from "./core/store.js";
import { createState } from "./state.js";
import { createLocal } from "./services/local.js";
import { createGitHub } from "./services/github.js";
import { createGemini } from "./services/gemini.js";
import { createVoice } from "./services/voice.js";
import { createPush } from "./services/push.js";
import { createSync } from "./services/sync.js";
import { createSession } from "./session.js";
import { createVocab } from "./vocab.js";
import { flash } from "./ui/dom.js";
import { createRouter } from "./ui/router.js";
import { createDock } from "./ui/dock.js";
import { createLearnView } from "./ui/views/learn.js";
import { createQuizView } from "./ui/views/quiz.js";
import { createListView } from "./ui/views/list.js";
import { createPhrasesView } from "./ui/views/phrases.js";
import { createPracticeView } from "./ui/views/practice.js";
import { createSettingsView } from "./ui/views/settings.js";

const C = window.APP;
const T = k => (C.t[k] !== undefined ? C.t[k] : k);
const local = createLocal(C.key);

/* Fortschritt aus dem Gerät; beim ersten Start darf die App alte Daten übernehmen (C.migrate) */
function loadP() {
  try { const p = JSON.parse(local.get(C.key) || "null"); if (p && p.v === 1) return Object.assign(emptyP(), p); } catch (e) {}
  const p = emptyP();
  if (C.migrate) try { C.migrate(p); } catch (e) {}
  return p;
}
const S = createState(prune(loadP()));
S.sync.token = local.get(local.key("token")) || "";
S.gkey = local.get(local.key("gemini")) || "";
const store = new CardStore(window.CARDS);

const ctx = { C, T, S, store, local, flash };
ctx.opt = (k, d) => optOf(S.P, k, d);
ctx.setOpt = (k, v) => { S.P.opts = S.P.opts || {}; S.P.opts[k] = v; ctx.changed(); };
ctx.writeLocal = () => local.set(C.key, JSON.stringify(S.P));
ctx.changed = () => { S.P.updated = Date.now(); S.dirty = true; ctx.writeLocal(); ctx.sync.schedule(); };
ctx.render = () => router.render();
ctx.badge = n => { try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {} };
ctx.github = createGitHub({ repo: C.repo, getToken: () => S.sync.token });
ctx.gemini = createGemini(() => S.gkey);
ctx.voice = createVoice({ gemini: ctx.gemini, getKey: () => S.gkey, opt: ctx.opt, local, voice: C.voice });
ctx.session = createSession(ctx);
ctx.sync = createSync(ctx);
ctx.push = createPush({ T, vapid: C.vapid, local, github: ctx.github, getToken: () => S.sync.token, flash, render: ctx.render });
ctx.vocab = createVocab(ctx);

const router = createRouter(ctx);
ctx.go = mode => router.go(mode);
ctx.dock = createDock(ctx, document.querySelector("nav"));
[createLearnView, createQuizView, createListView, ...(C.phrases ? [createPhrasesView] : []), createPracticeView, createSettingsView].forEach(make => router.register(make(ctx)));

/* Kein Zoomen: Pinch, Doppeltippen und Auto-Zoom in Eingabefeldern verhindern */
const vp = document.querySelector('meta[name="viewport"]');
if (vp) vp.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
document.addEventListener("touchmove", e => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });

ctx.vocab.startWorker();
ctx.session.ensureCur();
ctx.sync.setStatus(S.sync.token ? "syncing" : "local");
router.render();
if (S.sync.token) ctx.sync.sync(true).then(() => setTimeout(ctx.vocab.workQueue, 1500));
