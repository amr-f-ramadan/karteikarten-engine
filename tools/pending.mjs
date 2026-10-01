// Läuft in GitHub Actions. Erstellt Karten für Wörter auf der Warteliste (progress.json, Branch "progress")
// mit Gemini und hängt sie an cards.js im Branch main an. Braucht die Secrets GEMINI_KEY und GITHUB_TOKEN.
// Gemeinsam für alle Apps: Felder, Regeln und das Ersatz-Thema kommen wie in der App aus window.APP in index.html;
// Auftrag, Antwortform, ids und Wortfamilien kommen aus denselben Modulen wie in der App (src/core).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { CardStore } from "../src/core/store.js";
import { parseCards, appendCards } from "../src/core/cardsfile.js";
import { cardPrompt, cardSchema, goodCard } from "../src/core/prompt.js";
import { freeId, shapeCard } from "../src/core/newcard.js";
import { createGemini } from "../src/services/gemini.js";

const key = process.env.GEMINI_KEY, gh = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
if (!key || !gh || !repo) { console.log("GEMINI_KEY oder GITHUB_TOKEN fehlt, Warteliste wird übersprungen."); process.exit(0); }
const git = f => { try { return execSync(`git show origin/progress:${f}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const P = JSON.parse(git("progress.json") || "null") || {};
let src = readFileSync("cards.js", "utf8");
const store = new CardStore(parseCards(src));
const todo = Object.entries(P.pending || {}).filter(([k, s]) => !s.done && !s.k && !store.isDone(k)).slice(0, 5); // Wendungen (k: "p") erstellt die App selbst
if (!todo.length) { console.log("Warteliste ist leer."); process.exit(0); }

const appCtx = { window: {}, localStorage: { getItem: () => null } };
for (const m of readFileSync("index.html", "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], appCtx);
const APP = appCtx.window.APP || {};
const FIELDS = APP.fields, SCHEMA = cardSchema(FIELDS);
const gemini = createGemini(() => key);
const gen = async word => {
  try { return await gemini.generate(cardPrompt(APP.rules, FIELDS, word, { fams: store.famListFor(word), topics: store.topicList() }), SCHEMA, c => c.w); }
  catch (e) { console.log(`Gemini: ${e.message}`); return null; }
};

const added = [];
for (const [k, s] of todo) {
  const c = await gen(s.w);
  if (!goodCard(c)) { console.log(`Noch nicht möglich: ${s.w}`); continue; }
  const o = shapeCard(c, { id: freeId(c.w, id => store.hasId(id)), fields: FIELDS, newCat: APP.t.newCat, store, src: k });
  if (store.exists(o.w)) { console.log(`Schon vorhanden: ${o.w}`); continue; }
  store.push(o); added.push(o);
  src = appendCards(src, [o]);
}
if (!added.length) { console.log("Nichts hinzugefügt."); process.exit(0); }

const url = `https://api.github.com/repos/${repo}/contents/cards.js`;
const h = { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json" };
const cur = await (await fetch(url + "?ref=main", { headers: h })).json();
if (Buffer.from(cur.content, "base64").toString() !== readFileSync("cards.js", "utf8")) { console.log("cards.js hat sich gerade geändert, nächster Lauf versucht es wieder."); process.exit(0); }
const r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ message: "Warteliste: " + added.map(o => o.w).join(", "), branch: "main", sha: cur.sha, content: Buffer.from(src).toString("base64") }) });
console.log("cards.js:", r.status, added.map(o => o.w).join(", "));
