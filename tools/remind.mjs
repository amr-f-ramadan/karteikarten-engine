// Gemeinsames Skript beider Apps. Läuft im Ordner der App (cards.js, index.html) alle 15 Minuten in GitHub Actions.
// Titel und Texte kommen aus window.APP in index.html (t.appName, remind). Schickt einmal am Tag eine Erinnerung, sobald die eingestellte
// Uhrzeit erreicht ist und Karten fällig sind. Liest push.json und progress.json aus dem Branch "progress"
// und cards.js aus main. Merkt sich in sent.json (Branch "progress"), dass heute schon gesendet wurde.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import webpush from "web-push";

const force = process.env.FORCE === "true";
const git = f => { try { return execSync(`git show origin/progress:${f}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } };
const push = JSON.parse(git("push.json") || "null");
if (!push || !push.enabled || !push.sub) { console.log("Keine Erinnerung eingerichtet."); process.exit(0); }

const tz = push.tz || "Europe/Berlin";
const parts0 = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]));
const nowMin = (Number(parts0.hour) % 24) * 60 + Number(parts0.minute), nowSec = Number(parts0.second);
const target = Number(push.hour) * 60 + Number(push.minute || 0);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const sent = JSON.parse(git("sent.json") || "null");
const pad = n => String(n).padStart(2, "0");
const at = `${pad(Math.floor(target / 60))}:${pad(target % 60)}`;
// GitHub startet geplante Läufe oft verspätet oder lässt welche aus. Deshalb: Ein Lauf bis zu WAIT Minuten vor der
// Uhrzeit wartet und sendet pünktlich; ein späterer Lauf holt die Erinnerung am selben Tag nach.
const WAIT = 20;
if (!force) {
  // Einmal pro Tag und Uhrzeit: wird die Uhrzeit geändert, gilt die neue noch am selben Tag.
  if (sent && sent.d === today && (sent.at === undefined || sent.at === at)) { console.log("Heute schon gesendet."); process.exit(0); }
  const ahead = target - nowMin;
  if (ahead > WAIT) { console.log(`Jetzt ${pad(Math.floor(nowMin / 60))}:${pad(nowMin % 60)}, Erinnerung um ${at}.`); process.exit(0); }
  if (ahead > 0) {
    const ms = ahead * 60000 - nowSec * 1000;
    console.log(`Warte ${Math.round(ms / 1000)} Sekunden bis ${at}.`);
    await new Promise(r => setTimeout(r, ms));
  } else if (ahead < 0) console.log(`Erinnerung um ${at}, wird nachgeholt.`);
}

const ctx = { window: {} };
vm.runInNewContext(readFileSync("cards.js", "utf8"), ctx);
const cards = ctx.window.CARDS || [];
const appCtx = { window: {}, localStorage: { getItem: () => null } };
for (const m of readFileSync("index.html", "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], appCtx);
const APP = appCtx.window.APP || {};

const P = JSON.parse(git("progress.json") || "null") || { cards: {}, newDay: {}, opts: {} };
const now = Date.now();
const opt = (k, d) => (P.opts && P.opts[k] !== undefined ? P.opts[k] : d);
const isP = c => c.k === "p";
const due = cards.filter(c => P.cards[c.id] && P.cards[c.id].due <= now).length;
const newDay = P.newDay && P.newDay.d === today ? P.newDay : { n: 0, p: 0 };
const fresh = Math.min(cards.filter(c => !P.cards[c.id] && !isP(c)).length, Math.max(0, opt("newPerDay", APP.newPerDay || 10) - (newDay.n || 0)));
// Wendungen (k: "p") haben ein eigenes Tageslimit, nur wenn die App sie eingeschaltet hat (APP.phrases)
const freshP = APP.phrases ? Math.min(cards.filter(c => !P.cards[c.id] && isP(c)).length, Math.max(0, opt("newPhrases", APP.phrases.perDay || 3) - (newDay.p || 0))) : 0;
const total = due + fresh + freshP;
if (!total && !force) { console.log("Heute ist nichts mehr fällig."); process.exit(0); }

const R = APP.remind;
const parts = [];
if (due) parts.push(R.due(due));
if (fresh) parts.push(R.fresh(fresh));
if (freshP) parts.push(R.freshP ? R.freshP(freshP) : R.fresh(freshP));
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:noreply@example.com", process.env.VAPID_PUBLIC, process.env.VAPID_PRIVATE);
const msg = { title: APP.t.appName, body: parts.length ? R.body(parts) : R.test, count: total };
console.log("Nachricht:", msg.body);
try {
  await webpush.sendNotification(push.sub, JSON.stringify(msg));
  console.log("Gesendet.");
} catch (e) {
  console.error("Fehler beim Senden:", e.statusCode, e.body);
  process.exit(e.statusCode === 404 || e.statusCode === 410 ? 0 : 1);
}

// Merken, dass heute gesendet wurde (nicht beim Test)
if (!force && process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY) {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/contents/sent.json`;
  const h = { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };
  const g = await fetch(url + "?ref=progress", { headers: h });
  const shaOld = g.ok ? (await g.json()).sha : undefined;
  const r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ message: "Erinnerung gesendet", branch: "progress", sha: shaOld, content: Buffer.from(JSON.stringify({ d: today, at })).toString("base64") }) });
  console.log("sent.json:", r.status);
}
