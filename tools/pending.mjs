// Läuft in GitHub Actions. Erstellt Karten für Wörter auf der Warteliste (progress.json, Branch "progress")
// mit Gemini und hängt sie an cards.js im Branch main an. Braucht die Secrets GEMINI_KEY und GITHUB_TOKEN.
// Gemeinsam für alle Apps: Felder, Regeln und das Ersatz-Thema kommen wie in der App aus window.APP in index.html.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const key = process.env.GEMINI_KEY, gh = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
if (!key || !gh || !repo) { console.log("GEMINI_KEY oder GITHUB_TOKEN fehlt, Warteliste wird übersprungen."); process.exit(0); }
const git = f => { try { return execSync(`git show origin/progress:${f}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const P = JSON.parse(git("progress.json") || "null") || {};
const load = src => { const ctx = { window: {} }; vm.runInNewContext(src, ctx); return ctx.window.CARDS || []; };
let src = readFileSync("cards.js", "utf8");
let cards = load(src);
const isDone = k => cards.some(c => c.w.toLowerCase() === k || c.src === k);
const todo = Object.entries(P.pending || {}).filter(([k, s]) => !s.done && !s.k && !isDone(k)).slice(0, 5); // Wendungen (k: "p") erstellt die App selbst
if (!todo.length) { console.log("Warteliste ist leer."); process.exit(0); }

const appCtx = { window: {}, localStorage: { getItem: () => null } };
for (const m of readFileSync("index.html", "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], appCtx);
const APP = appCtx.window.APP || {};
const newCat = APP.t.newCat;

const famKey = c => c.fam || c.w.toLowerCase();
const plainDe = t => String(t || "").toLowerCase().replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
const sameStem = (w, fam) => { const st = plainDe(fam).replace(/(end|ern|eln|en|n|e)$/, ""); return st.length >= 3 && plainDe(w).includes(st); };
const topicOf = list => { const n = {}; list.forEach(x => { if (x.cat) n[x.cat] = (n[x.cat] || 0) + 1; }); let best = null; for (const x of list) if (x.cat && (!best || n[x.cat] > n[best])) best = x.cat; return best; };
const FIELDS = APP.fields;
const RULES = APP.rules;
const famList = () => [...new Set(cards.map(famKey))].join(", ");
const topicList = () => [...new Set(cards.map(c => c.cat).filter(Boolean))].join(", ");
const PROMPT = w => [RULES.intro, `Wort oder Ausdruck: "${w}"`, "Regeln:"]
  .concat(FIELDS.map(f => "- " + RULES[f].replace("{fams}", famList).replace("{topics}", topicList)), RULES.end).join("\n");
const SCHEMA = { type: "OBJECT",
  properties: Object.fromEntries(FIELDS.map(f => [f, f === "g" ? { type: "STRING", enum: ["der", "die", "das", "pl", "x"] } : { type: "STRING" }])),
  required: FIELDS.filter(f => f !== "perf" && f !== "note") };
async function gen(word) {
  for (const m of ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash"]) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: PROMPT(word) }] }], generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.4 } })
    });
    if (r.status === 404 || r.status === 429 || r.status >= 500) { console.log(`${m}: ${r.status}`); continue; }
    if (!r.ok) { console.log(`${m}: ${r.status}`); return null; }
    const j = await r.json();
    try { return JSON.parse(j.candidates[0].content.parts.map(p => p.text || "").join("")); } catch { return null; }
  }
  return null;
}
const slug = w => w.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]/g, "").slice(0, 30) || "wort";

const added = [];
for (const [k, s] of todo) {
  const c = await gen(s.w);
  if (!c || !c.w || !c.ar || !c.ex) { console.log(`Noch nicht möglich: ${s.w}`); continue; }
  let id = slug(c.w), n = 2;
  while (cards.some(x => x.id === id)) id = slug(c.w) + n++;
  const o = { id, g: c.g, w: c.w, cat: (c.cat || "").trim() || newCat, hint: c.hint || "", ar: c.ar };
  if (FIELDS.includes("def")) o.def = c.def || "";
  o.ex = c.ex; if (c.tr) o.tr = c.tr; o.src = k;
  if (c.perf) o.perf = c.perf; if (c.note) o.note = c.note;
  const fk = (c.fam || "").trim().toLowerCase();
  if (fk && sameStem(o.w, fk) && (fk !== o.w.toLowerCase() || cards.some(x => famKey(x) === fk))) o.fam = fk;
  if (o.fam) { const kin = cards.filter(x => famKey(x) === o.fam && x.cat); if (kin.length) o.cat = topicOf(kin); }
  if (cards.some(x => x.w.toLowerCase() === o.w.toLowerCase())) { console.log(`Schon vorhanden: ${o.w}`); continue; }
  cards.push(o); added.push(o);
  const i = src.lastIndexOf("\n];");
  src = src.slice(0, i) + ",\n " + JSON.stringify(o) + src.slice(i);
}
if (!added.length) { console.log("Nichts hinzugefügt."); process.exit(0); }

const url = `https://api.github.com/repos/${repo}/contents/cards.js`;
const h = { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json" };
const cur = await (await fetch(url + "?ref=main", { headers: h })).json();
if (Buffer.from(cur.content, "base64").toString() !== readFileSync("cards.js", "utf8")) { console.log("cards.js hat sich gerade geändert, nächster Lauf versucht es wieder."); process.exit(0); }
const r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ message: "Warteliste: " + added.map(o => o.w).join(", "), branch: "main", sha: cur.sha, content: Buffer.from(src).toString("base64") }) });
console.log("cards.js:", r.status, added.map(o => o.w).join(", "));
