// Unit tests for the pure core modules (node --test tests/unit/). No browser, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, sameStem, topicOf, norm, pk, pkey, fullWord, fill, today } from "../../src/core/text.js";
import { INT, recordAnswer, freshCards, dueCards, newToday, allowMoreNew, boxOf } from "../../src/core/leitner.js";
import { emptyP, merge, prune } from "../../src/core/progress.js";
import { CardStore } from "../../src/core/store.js";
import { cardPrompt, cardSchema, phrasePrompt, starterPrompt, enPrompt, EN_SCHEMA, anyPrompt, anySchema, goodAny, fillPrompt, fillSchema } from "../../src/core/prompt.js";
import { diffHTML } from "../../src/core/diff.js";
import { parseCards, serializeCards, appendCards } from "../../src/core/cardsfile.js";
import { freeId, shapeCard, withEn, withFields, mergeFamily, guessPos, pickFace, faceOf } from "../../src/core/newcard.js";
import { nearestTurn, settleTarget, glideDuration } from "../../src/core/dock.js";
import { RECENT, nounWeight, pickNoun } from "../../src/core/quiz.js";

const DAY = 864e5, day = "2026-10-01";
const cards = () => [
  { id: "blick", g: "der", w: "Blick", cat: "Wohnen", ar: "نظرة", ex: "Ein <b>Blick</b>.", fam: "blick" },
  { id: "umziehen", g: "x", w: "umziehen", cat: "Wohnen", ar: "ينقل", ex: "Wir <b>ziehen um</b>.", fam: "ziehen" },
  { id: "ausblick", g: "der", w: "Ausblick", cat: "Wohnen", ar: "إطلالة", ex: "Toller <b>Ausblick</b>.", fam: "blick" },
  { id: "miete", g: "die", w: "Miete", cat: "Geld", ar: "إيجار", ex: "Die <b>Miete</b>.", src: "miete" },
  { id: "alsoich", k: "p", g: "x", w: "Also, ich denke, dass …", cat: "Füllwort", ar: "يعني", ex: "<b>Also, ich denke, dass</b> es geht." }
];

test("text helpers", () => {
  assert.equal(slug("Übergröße!"), "uebergroesse");
  assert.equal(slug("…"), "wort");
  assert.ok(sameStem("Empfindung", "empfinden"));
  assert.ok(!sameStem("verlassen", "abwesend"));
  assert.equal(topicOf([{ cat: "A" }, { cat: "B" }, { cat: "B" }]), "B");
  assert.equal(norm("Grüße <b>die</b> Fläche"), "grusse die flache");
  assert.equal(pk("Also, ich denke, dass …"), "also ich denke dass");
  assert.equal(pkey("die Miete"), "miete");
  assert.equal(fullWord({ g: "pl", w: "Leute" }), "die Leute");
  assert.equal(fill("a {x} {y}", { x: 1 }), "a 1 {y}");
});

test("today: the day of the daily limit is the local date, not the UTC date", () => {
  assert.equal(today("Europe/Berlin", new Date("2026-03-31T22:30:00Z")), "2026-04-01", "shortly after midnight in Berlin the UTC date is still yesterday");
  assert.equal(today("Pacific/Pago_Pago", new Date("2026-04-01T09:00:00Z")), "2026-03-31", "west of UTC the local date is behind");
  assert.equal(today("Europe/Berlin", new Date("2026-04-01T12:00:00Z")), "2026-04-01");
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  assert.equal(today(), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, "without a zone: the device's date");
});

test("leitner: answers move through the boxes, wrong answers reset", () => {
  const P = emptyP(), c = { id: "a" }, now = Date.parse("2026-10-01T10:00:00");
  const s = recordAnswer(P, c, true, now, day);
  assert.equal(s.b, 1); assert.equal(P.newDay.n, 1);
  recordAnswer(P, c, true, now, day); recordAnswer(P, c, true, now, day);
  assert.equal(P.cards.a.b, 3); assert.equal(P.cards.a.due > now + 6 * DAY, true);
  recordAnswer(P, c, false, now, day);
  assert.equal(P.cards.a.b, 0); assert.equal(P.cards.a.due, now); assert.equal(P.cards.a.w, 1);
  for (let i = 0; i < 10; i++) recordAnswer(P, c, true, now, day);
  assert.equal(P.cards.a.b, INT.length - 1, "box does not grow past the last interval");
  assert.equal(P.newDay.n, 1, "a card counts as new only once");
  recordAnswer(P, { id: "p1", k: "p" }, true, now, day);
  assert.equal(newToday(P, day, "p"), 1); assert.equal(newToday(P, "2026-10-02"), 0);
});

test("leitner: fresh cards respect both daily limits, due cards sorted", () => {
  const P = emptyP(), st = new CardStore(cards());
  assert.deepEqual(freshCards(st.words, st.phrases, P, day, { words: 2, phrases: 1 }).map(c => c.id), ["blick", "umziehen", "alsoich"]);
  assert.deepEqual(freshCards(st.words, null, P, day, { words: 10, phrases: 0 }).map(c => c.id), ["blick", "umziehen", "ausblick", "miete"]);
  P.cards.miete = { b: 1, due: 5, t: 1, n: 1, w: 0 }; P.cards.blick = { b: 1, due: 1, t: 1, n: 1, w: 0 };
  assert.deepEqual(dueCards(st.all, P, 10).map(c => c.id), ["blick", "miete"]);
  assert.equal(boxOf(P, st.byId("ausblick")), -1);
  P.newDay = { d: day, n: 10, p: 2 };
  allowMoreNew(P, day, 10);
  assert.deepEqual(P.newDay, { d: day, n: 0, p: 2 });
});

test("progress merge: newer per-card state wins, same-day counts take the max", () => {
  const a = emptyP(), b = emptyP();
  a.cards.x = { b: 2, due: 5, t: 10, n: 2, w: 0 }; b.cards.x = { b: 0, due: 1, t: 20, n: 3, w: 1 };
  a.cards.y = { b: 1, due: 1, t: 5, n: 1, w: 0 };
  a.newDay = { d: day, n: 3, p: 1 }; b.newDay = { d: day, n: 5 };
  a.opts = { slow: true, newPerDay: 5 }; a.updated = 100; b.opts = { newPerDay: 8 }; b.updated = 50;
  const m = merge(a, b);
  assert.equal(m.cards.x.t, 20); assert.ok(m.cards.y);
  assert.deepEqual(m.newDay, { d: day, n: 5, p: 1 });
  assert.deepEqual(m.opts, { slow: true, newPerDay: 5 }, "options of the newer side win");
  assert.equal(m.updated, 100);
});

test("card store: indexes, families in list order, lookups", () => {
  const st = new CardStore(cards());
  assert.deepEqual(st.words.map(c => c.id), ["blick", "umziehen", "ausblick", "miete"]);
  assert.deepEqual(st.phrases.map(c => c.id), ["alsoich"]);
  assert.deepEqual(st.nouns.map(c => c.id), ["blick", "ausblick", "miete"]);
  assert.deepEqual(st.relatives(st.byId("blick")).map(c => c.id), ["ausblick"]);
  assert.deepEqual(st.grouped().map(([c, sub, fam]) => c.id + (sub ? "+" : "") + (fam ? "*" : "")), ["blick*", "ausblick+*", "umziehen", "miete"]);
  assert.equal(st.famList(), "blick, ziehen, miete");
  assert.equal(st.topicList(), "Wohnen, Geld");
  assert.equal(st.phraseGroups(), "Füllwort");
  assert.ok(st.exists("die Miete")); assert.ok(!st.exists("Mieter"));
  assert.ok(st.existsP("also ich denke dass")); assert.ok(st.isDone("miete"));
  assert.equal(st.hay(st.byId("blick")).replace(/\s+/g, " ").trim(), "der blick نظرة ein blick. wohnen blick");
  st.push({ id: "neu", g: "x", w: "neu", cat: "Geld", ar: "", ex: "", fam: "blick" });
  assert.deepEqual(st.family(st.byId("blick")).map(c => c.id), ["blick", "ausblick", "neu"], "indexes rebuild after push");
  assert.ok(st.remove("neu")); assert.equal(st.byId("neu"), null);
  const fresh = st.syncWith(cards().filter(c => c.id !== "miete").concat([{ id: "z", g: "x", w: "z", ar: "", ex: "" }]));
  assert.deepEqual(fresh.map(c => c.id), ["z"]);
  assert.deepEqual(st.all.map(c => c.id), ["blick", "umziehen", "ausblick", "alsoich", "z"]);
});

test("prompts: rules filled with the current families and topics", () => {
  const rules = { intro: "I", w: "w rule", fam: "fams: {fams}", cat: "topics: {topics}", end: "E" };
  const p = cardPrompt(rules, ["w", "fam", "cat"], "Haus", { fams: "a, b", topics: "T1" });
  assert.equal(p, 'I\nWort oder Ausdruck: "Haus"\nRegeln:\n- w rule\n- fams: a, b\n- topics: T1\nE');
  assert.deepEqual(cardSchema(["w", "g", "note", "perf"]).required, ["w", "g"]);
  assert.deepEqual(cardSchema(["w", "g"]).properties.g.enum, ["der", "die", "das", "pl", "x"]);
  const ph = { fields: ["w", "cat"], rules: { intro: "PI", w: "pw", cat: "g: {groups}", end: "PE" }, starter: "S" };
  assert.equal(phrasePrompt(ph, "Also", "A, B"), 'PI\nWendung oder Ausdruck: "Also"\nRegeln:\n- pw\n- g: A, B\nPE');
  assert.equal(starterPrompt(ph, "A"), "S\nRegeln für jede Wendung:\n- pw\n- g: A\nPE");
});

test("diff: errors and style improvements are marked word by word", () => {
  assert.equal(diffHTML("Die Miete ist zu hoch.", "Die Miete ist zu hoch."), "Die Miete ist zu hoch.");
  const kinds = new Set();
  const h = diffHTML("Die Miete sind zu hoch", "Die Miete ist wirklich zu hoch.", [{ wrong: "sind", right: "ist", kind: "error" }, { wrong: "", right: "wirklich", kind: "style" }], kinds);
  assert.equal(h, 'Die Miete <del class="err">sind</del> <ins class="err">ist</ins> <ins class="sty">wirklich</ins> zu hoch<ins class="err">.</ins>');
  assert.deepEqual([...kinds].sort(), ["err", "sty"]);
  assert.equal(diffHTML("a <b", "a <c"), 'a &lt;<del class="err">b</del><ins class="err">c</ins>', "HTML in answers is escaped");
});

test("cards.js: append keeps the file byte for byte, remove rewrites one line per card", () => {
  const src = "// head\nwindow.CARDS = [\n " + JSON.stringify(cards()[0]) + "\n];\n";
  const added = { id: "neu", g: "x", w: "neu", ar: "", ex: "" };
  const out = appendCards(src, [added]);
  assert.equal(out, src.replace("\n];", ",\n " + JSON.stringify(added) + "\n];"));
  assert.deepEqual(parseCards(out).map(c => c.id), ["blick", "neu"]);
  assert.equal(serializeCards("// head\n", parseCards(out).filter(c => c.id !== "blick")), "// head\nwindow.CARDS = [\n " + JSON.stringify(added) + "\n];\n");
  assert.throws(() => appendCards("nope", []), /format/);
});

test("store: only families with a matching stem go into the prompt", () => {
  const st = new CardStore(cards());
  assert.equal(st.famListFor("Einblick"), "blick");
  assert.equal(st.famListFor("ziehen"), "ziehen");
  assert.equal(st.famListFor("Haus"), "keine");
  assert.equal(st.famListFor("شقة"), "keine");
});

test("new card: id, fields, family and topic are shaped the same way for the app and the tool", () => {
  const st = new CardStore(cards());
  assert.equal(freeId("Blick", id => st.hasId(id)), "blick2");
  assert.equal(freeId("Haus", id => st.hasId(id)), "haus");
  const gen = { w: "Einblick", g: "der", cat: "", hint: "", ar: "لمحة", def: "D", ex: "Ein <b>Einblick</b>.", tr: "", perf: "", note: "N", fam: "Blick" };
  const o = shapeCard(gen, { id: "einblick", fields: ["w", "g", "hint", "ar", "def", "ex", "note", "fam", "cat"], newCat: "Neu", store: st, src: "einblick" });
  assert.deepEqual(o, { id: "einblick", g: "der", w: "Einblick", cat: "Wohnen", hint: "", ar: "لمحة", def: "D", ex: "Ein <b>Einblick</b>.", note: "N", src: "einblick", fam: "blick" }, "family accepted, topic taken from the family");
  assert.deepEqual(Object.keys(o), ["id", "g", "w", "cat", "hint", "ar", "def", "ex", "note", "src", "fam"], "the app's field order in cards.js");
  const p = shapeCard({ w: "Haus", g: "das", ar: "بيت", ex: "x", fam: "wohnen", def: "D" }, { id: "haus", fields: ["w", "g", "hint", "ar", "ex"], newCat: "Neu", store: st });
  assert.deepEqual(p, { id: "haus", g: "das", w: "Haus", cat: "Neu", hint: "", ar: "بيت", ex: "x" }, "no def without the field, a family with another stem is dropped, topic falls back");
});

test("dock: a loop of five draws each item at its nearest turn, a lift settles on a slot", () => {
  assert.deepEqual([0, 1, 2, 3, 4, -1, -3, 7].map(d => nearestTurn(d, 5)), [0, 1, 2, -2, -1, -1, 2, 2]);
  assert.ok(Math.abs(nearestTurn(2.6, 5) + 2.4) < 1e-9);
  assert.equal(settleTarget(1.4, 0, 1 / 72, 1), 1, "no speed: nearest slot");
  assert.equal(settleTarget(1.4, -0.9, 1 / 72, 1), 3, "a flick to the left carries two slots further");
  assert.equal(settleTarget(1.4, -0.9, 1 / 72, -1), -1, "mirrored for RTL");
  assert.equal(settleTarget(1.4, -9, 1 / 72, 1), 3, "a flick carries two slots at most");
  assert.equal(glideDuration(0), 200); assert.equal(glideDuration(2), 440); assert.equal(glideDuration(9), 520);
});

test("progress: done waitlist entries older than 30 days are pruned", () => {
  const P = emptyP(), now = 100 * 864e5;
  P.pending = { old: { w: "old", t: now - 31 * 864e5, done: true }, fresh: { w: "fresh", t: now - 29 * 864e5, done: true }, open: { w: "open", t: now - 90 * 864e5 } };
  prune(P, now);
  assert.deepEqual(Object.keys(P.pending), ["fresh", "open"]);
});

test("quiz: weights follow the answers, the last shown nouns are skipped", () => {
  assert.equal(nounWeight(undefined), 3, "never asked");
  assert.equal(nounWeight({ ok: 0, w: 2 }), 7, "wrong twice");
  assert.equal(nounWeight({ ok: 6, w: 0 }), 0.3, "well known: never below 0.3");
  const nouns = Array.from({ length: 12 }, (_, i) => ({ id: "n" + i, g: "der" }));
  assert.equal(pickNoun(nouns, {}, ["n0", "n1"], () => 0).id, "n2", "the first noun not shown lately");
  assert.equal(pickNoun(nouns, {}, [], () => 0.999999).id, "n11", "the draw never runs past the last noun");
  assert.equal(pickNoun([nouns[0]], {}, ["n0"]).id, "n0", "a single noun is always asked");
  assert.equal(pickNoun(nouns.slice(0, 3), {}, ["n0", "n1", "n2"], () => 0).id, "n0", "with three nouns only the last two shown are skipped");
  assert.equal(pickNoun([], {}, []), null);
  const art = { n3: { ok: 0, w: 5 } };
  assert.equal(pickNoun(nouns, art, [], () => 0.5).id, "n3", "a noun wrong five times (weight 16) takes half the range");
  const shown = []; let seed = 7;
  const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) { shown.push(pickNoun(nouns, {}, shown, rnd).id); }
  assert.ok(shown.every((id, i) => !shown.slice(Math.max(0, i - RECENT), i).includes(id)), "no noun comes back within eight picks");
});

test("english meaning: shaped after ar, added to an old card in place, asked for in batches", () => {
  const st = new CardStore(cards());
  const o = shapeCard({ w: "Haus", g: "das", ar: "بيت", en: "house", ex: "x" }, { id: "haus", fields: ["w", "g", "ar", "en", "ex"], newCat: "Neu", store: st });
  assert.deepEqual(Object.keys(o), ["id", "g", "w", "cat", "hint", "ar", "en", "ex"], "en sits after ar");
  assert.equal(shapeCard({ w: "Haus", g: "das", ar: "بيت", ex: "x" }, { id: "haus", fields: ["w", "g", "ar", "ex"], newCat: "Neu", store: st }).en, undefined, "no en without the field");
  const old = { id: "blick", g: "der", w: "Blick", cat: "Wohnen", ar: "نظرة", ex: "E", fam: "blick" };
  assert.deepEqual(Object.keys(withEn(old, "glance")), ["id", "g", "w", "cat", "ar", "en", "ex", "fam"], "en placed after ar in an old card");
  assert.equal(withEn(old, "glance").en, "glance");
  assert.deepEqual(Object.keys(withEn({ id: "x", w: "x" }, "e")), ["id", "w", "en"], "without ar it goes last");
  const p = enPrompt({ intro: "I", en: "en: short English", end: "E" }, [old, { id: "alsoich", k: "p", g: "x", w: "Also …", ar: "يعني" }]);
  assert.equal(p, 'I\nErgänze für jede Karte nur die Felder en und gib ihre id unverändert zurück.\n- en: short English\nKarten:\n{"id":"blick","w":"der Blick","ar":"نظرة"}\n{"id":"alsoich","w":"Also …","ar":"يعني"}\nE');
  assert.deepEqual(EN_SCHEMA.items.required, ["id", "en"]);
  st.patch("blick", { en: "glance" }); assert.ok(st.hay(st.byId("blick")).includes("glance"), "the search text knows the English meaning");
});

test("synonyms, forms, one prompt for both kinds, fill and family merge", () => {
  const st = new CardStore(cards()), F = ["w", "g", "hint", "ar", "en", "ex", "note", "syn", "forms", "fam", "cat"];
  const gen = { w: "empfinden", g: "x", hint: "", ar: "يحس", en: "to feel", ex: "E", note: "", syn: "fühlen, spüren", fam: "empfinden", cat: "Gefühle",
    forms: [{ w: "Empfindung", g: "die", pos: "n", ar: "إحساس", en: "sensation" }, { w: "empfindlich", g: "x", pos: "adj", ar: "حساس", en: "sensitive" }, { w: "empfinden", g: "x", pos: "v", ar: "x" }, { w: "", g: "x", pos: "v", ar: "x" }] };
  const o = shapeCard(gen, { id: "empfinden", fields: F, newCat: "Neu", store: st });
  assert.deepEqual(Object.keys(o), ["id", "g", "w", "cat", "hint", "ar", "en", "ex", "syn", "forms"], "syn and forms after ex (no family of its own word yet)");
  assert.equal(o.forms.length, 2, "the word itself and an empty form are dropped");
  assert.deepEqual(o.forms[0], { w: "Empfindung", g: "die", pos: "n", ar: "إحساس", en: "sensation" });
  assert.equal(shapeCard(Object.assign({}, gen, { syn: " ", forms: [] }), { id: "x", fields: F, newCat: "N", store: st }).syn, "", "an empty syn is kept: the card was asked");
  assert.deepEqual(shapeCard(Object.assign({}, gen, { forms: [] }), { id: "x", fields: F, newCat: "N", store: st }).forms, [], "an empty forms list is kept too");
  assert.equal(cardSchema(F).required.includes("syn"), false); assert.equal(cardSchema(F).properties.forms.items.properties.en.type, "STRING");
  assert.deepEqual(guessPos("sich verlassen auf", "x"), "v"); assert.equal(guessPos("zwingend", "x"), "adj"); assert.equal(guessPos("Abwesenheit", "die"), "n");
  // one request for word or phrase
  const C = { fields: ["w", "g", "ar", "fam"], rules: { intro: "I", w: "W", g: "G", ar: "A", fam: "F {fams}", end: "E" }, phrases: { fields: ["w", "ar", "cat"], rules: { w: "PW", ar: "PA", cat: "PC {groups}" } } };
  const p = anyPrompt(C, "Haus", { fams: "a", topics: "t", groups: "g1" });
  assert.equal(p, 'I\nEingabe: "Haus"\nEntscheide zuerst: kind "w" für ein einzelnes Wort oder einen kurzen Ausdruck mit Grundform, kind "p" für eine feste Wendung, einen Satzanfang oder ein Füllwort. Fülle nur die Felder dieser Art.\nWenn kind w, Regeln:\n- W\n- G\n- A\n- F a\nWenn kind p, Regeln:\n- PW\n- PA\n- PC g1\nE');
  const sch = anySchema(C.fields, C.phrases.fields);
  assert.deepEqual(Object.keys(sch.properties), ["kind", "w", "g", "ar", "fam", "cat"]); assert.deepEqual(sch.required, ["kind", "w", "ar", "ex"]);
  assert.ok(goodAny({ kind: "p", w: "x", ar: "y", ex: "z" }) && !goodAny({ kind: "q", w: "x", ar: "y", ex: "z" }));
  // fill prompt and schema
  const fp = fillPrompt({ intro: "I", en: "EN", syn: "SY", forms: "FO", end: "E" }, ["en", "syn", "forms"], [{ id: "a", g: "der", w: "Blick", ar: "ن" }]);
  assert.equal(fp, 'I\nErgänze für jede Karte nur die Felder en, syn, forms und gib ihre id unverändert zurück.\n- EN\n- SY\n- FO\nKarten:\n{"id":"a","w":"der Blick","ar":"ن"}\nE');
  assert.deepEqual(fillSchema(["en", "syn", "forms"], F).items.required, ["id", "en"]);
  // fields land in their slots
  const old = { id: "blick", g: "der", w: "Blick", cat: "Wohnen", ar: "نظرة", ex: "E", tr: "T", note: "N", fam: "blick" };
  assert.deepEqual(Object.keys(withFields(old, { en: "glance", syn: "Sicht", forms: [{ w: "blicken", g: "x", pos: "v", ar: "ينظر" }] })), ["id", "g", "w", "cat", "ar", "en", "ex", "tr", "syn", "forms", "note", "fam"]);
  assert.deepEqual(Object.keys(withFields({ id: "x", w: "x", ar: "a", ex: "e" }, { forms: [{ w: "y" }], syn: "", en: undefined })), ["id", "w", "ar", "ex", "syn", "forms"], "empty syn is kept, undefined is not, forms after syn");
  // family merge: the stem is the base, the others become forms, the best progress is kept
  const fam = [{ id: "empfindlich", g: "x", w: "empfindlich", ar: "حساس", en: "sensitive", ex: "1", fam: "empfinden" }, { id: "empfinden", g: "x", w: "empfinden", ar: "يحس", ex: "2", fam: "empfinden" }, { id: "empfindung", g: "die", w: "Empfindung", ar: "إحساس", ex: "3", fam: "empfinden" }];
  const m = mergeFamily(fam, { empfindlich: { b: 3, due: 9, t: 1 }, empfinden: { b: 1, due: 5, t: 1 }, empfindung: { b: 3, due: 7, t: 1 } });
  assert.equal(m.base.id, "empfinden"); assert.deepEqual(m.removed, ["empfindlich", "empfindung"]);
  assert.deepEqual(m.base.forms.map(f => [f.w, f.g, f.pos]), [["empfindlich", "x", "adj"], ["Empfindung", "die", "n"]]);
  assert.deepEqual(m.entry, { b: 3, due: 7, t: 1 }, "highest box, earliest due");
  const w = mergeFamily([{ id: "a", g: "x", w: "sich zur Wehr setzen", ar: "1", ex: "", fam: "wehren" }, { id: "b", g: "x", w: "sich wehren", ar: "2", ex: "", fam: "wehren" }]);
  assert.equal(w.base.id, "b", "the shortest word containing the stem"); assert.equal(w.base.forms[0].pos, "v"); assert.equal(w.entry, null);
  // which face is learned
  const c = { w: "empfinden", forms: [{ w: "Empfindung" }, { w: "empfindlich" }] };
  assert.equal(pickFace(c, 0.2), 0); assert.equal(pickFace(c, 0.5), 1); assert.equal(pickFace(c, 0.99), 2); assert.equal(pickFace({ w: "x" }, 0.9), 0);
  assert.equal(faceOf(c, 2).w, "empfindlich"); assert.equal(faceOf(c, 0), c);
  st.replace(Object.assign({}, st.byId("blick"), { syn: "Schau" })); assert.ok(st.hay(st.byId("blick")).includes("schau"), "the search text knows synonyms after a replace");
});
