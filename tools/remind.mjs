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
const parts0 = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map(p => [p.type, p.value]));
const nowMin = (Number(parts0.hour) % 24) * 60 + Number(parts0.minute);
const target = Number(push.hour) * 60 + Number(push.minute || 0);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const sent = JSON.parse(git("sent.json") || "null");
const pad = n => String(n).padStart(2, "0");
const at = `${pad(Math.floor(target / 60))}:${pad(target % 60)}`;
if (!force) {
  if (sent && sent.d === today) { console.log("Heute schon gesendet."); process.exit(0); }
  if (nowMin < target || nowMin - target > 120) { console.log(`Jetzt ${pad(Math.floor(nowMin / 60))}:${pad(nowMin % 60)}, Erinnerung um ${at}.`); process.exit(0); }
}

const ctx = { window: {} };
vm.runInNewContext(readFileSync("cards.js", "utf8"), ctx);
const cards = ctx.window.CARDS || [];
const P = JSON.parse(git("progress.json") || "null") || { cards: {}, newDay: {}, opts: {} };
const now = Date.now();
const due = cards.filter(c => P.cards[c.id] && P.cards[c.id].due <= now).length;
const perDay = (P.opts && P.opts.newPerDay !== undefined) ? P.opts.newPerDay : 10;
const doneNew = P.newDay && P.newDay.d === today ? P.newDay.n : 0;
const fresh = Math.min(cards.filter(c => !P.cards[c.id]).length, Math.max(0, perDay - doneNew));
const total = due + fresh;
if (!total && !force) { console.log("Heute ist nichts mehr fällig."); process.exit(0); }

const appCtx = { window: {}, localStorage: { getItem: () => null } };
for (const m of readFileSync("index.html", "utf8").matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInNewContext(m[1], appCtx);
const APP = appCtx.window.APP || {};
const R = APP.remind;
const parts = [];
if (due) parts.push(R.due(due));
if (fresh) parts.push(R.fresh(fresh));
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
  const r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify({ message: "Erinnerung gesendet", branch: "progress", sha: shaOld, content: Buffer.from(JSON.stringify({ d: today })).toString("base64") }) });
  console.log("sent.json:", r.status);
}
