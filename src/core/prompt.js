// Aufträge und Antwortformen für Gemini. Die Regeln und Texte kommen aus window.APP (rules, phrases, practice).
import { fullWord } from "./text.js";
const STR = { type: "STRING" };
const LIST = { type: "ARRAY", items: STR };

const G = { type: "STRING", enum: ["der", "die", "das", "pl", "x"] };
/* forms: die anderen Wortarten der Familie, je mit Artikel, Wortart und Bedeutung (en nur, wenn die App es hat) */
const formsSchema = fields => ({ type: "ARRAY", items: { type: "OBJECT", properties: Object.assign({ w: STR, g: G, pos: { type: "STRING", enum: ["n", "v", "adj", "adv"] }, ar: STR }, fields.includes("en") ? { en: STR } : {}), required: ["w", "g", "pos", "ar"] } });
const prop = (f, fields) => (f === "g" ? G : f === "forms" ? formsSchema(fields) : STR);
const OPTIONAL = ["perf", "note", "syn", "forms"];
export const cardSchema = fields => ({ type: "OBJECT",
  properties: Object.fromEntries(fields.map(f => [f, prop(f, fields)])),
  required: fields.filter(f => !OPTIONAL.includes(f)) });
/* lists: { fams, topics } als fertige Aufzählungen für {fams} und {topics} in den Regeln */
export const cardPrompt = (rules, fields, word, lists) => [rules.intro, `Wort oder Ausdruck: "${word}"`, "Regeln:"]
  .concat(fields.map(f => "- " + rules[f].replace("{fams}", () => lists.fams).replace("{topics}", () => lists.topics)), rules.end).join("\n");
export const goodCard = c => !!(c && c.w && c.ar && c.ex);

export const phraseSchema = fields => ({ type: "OBJECT", properties: Object.fromEntries(fields.map(f => [f, STR])), required: fields.filter(f => f !== "note") });
export const starterSchema = fields => ({ type: "ARRAY", items: phraseSchema(fields) });
const phraseRules = (ph, groups) => ph.fields.map(f => "- " + ph.rules[f].replace("{groups}", () => groups)).concat(ph.rules.end);
export const phrasePrompt = (ph, word, groups) => [ph.rules.intro, `Wendung oder Ausdruck: "${word}"`, "Regeln:"].concat(phraseRules(ph, groups)).join("\n");
export const starterPrompt = (ph, groups) => [ph.starter, "Regeln für jede Wendung:"].concat(phraseRules(ph, groups)).join("\n");
export const goodPhrase = p => !!(p && p.w && p.ar && p.ex);

/* Ein Auftrag für beides: Gemini entscheidet, ob die Eingabe ein Wort (kind w) oder eine Wendung (kind p) ist, und baut
   die Karte nach den Regeln dieser Art; die Antwortform ist die Vereinigung beider Feldlisten */
export const anySchema = (fields, pfields) => {
  const all = [...new Set([...fields, ...pfields])];
  return { type: "OBJECT", properties: Object.assign({ kind: { type: "STRING", enum: ["w", "p"] } }, Object.fromEntries(all.map(f => [f, prop(f, fields)]))), required: ["kind", "w", "ar", "ex"] };
};
export const anyPrompt = (C, word, lists) => [C.rules.intro, `Eingabe: "${word}"`,
  'Entscheide zuerst: kind "w" für ein einzelnes Wort oder einen kurzen Ausdruck mit Grundform, kind "p" für eine feste Wendung, einen Satzanfang oder ein Füllwort. Fülle nur die Felder dieser Art.',
  "Wenn kind w, Regeln:"].concat(C.fields.map(f => "- " + C.rules[f].replace("{fams}", () => lists.fams).replace("{topics}", () => lists.topics)),
  ["Wenn kind p, Regeln:"], C.phrases.fields.map(f => "- " + C.phrases.rules[f].replace("{groups}", () => lists.groups)), [C.rules.end]).join("\n");
export const goodAny = c => !!(c && (c.kind === "w" || c.kind === "p") && c.w && c.ar && c.ex);

/* Vorhandene Karten ergänzen: je Karte nur id, Wort und Arabisch; die gewünschten Felder (en, syn, forms) mit den Regeln der App */
export const fillSchema = (want, fields) => ({ type: "ARRAY", items: { type: "OBJECT", properties: Object.assign({ id: STR }, Object.fromEntries(want.map(f => [f, prop(f, fields)]))), required: ["id"].concat(want.filter(f => f === "en")) } });
export const fillPrompt = (rules, want, cards) => [rules.intro, `Ergänze für jede Karte nur die Felder ${want.join(", ")} und gib ihre id unverändert zurück.`]
  .concat(want.map(f => "- " + rules[f]), ["Karten:"], cards.map(c => JSON.stringify({ id: c.id, w: fullWord(c), ar: c.ar })), [rules.end]).join("\n");
export const EN_SCHEMA = fillSchema(["en"], ["en"]);
export const enPrompt = (rules, cards) => fillPrompt(rules, ["en"], cards);

export const PR_TASK = { type: "OBJECT", properties: { task: STR, starter: STR }, required: ["task", "starter"] };
const EDITS = { type: "ARRAY", items: { type: "OBJECT", properties: { wrong: STR, right: STR, kind: { type: "STRING", enum: ["error", "style"] } }, required: ["wrong", "right", "kind"] } };
export const PR_FB = { type: "OBJECT", properties: { correct: { type: "BOOLEAN" }, corrected: STR, natural: STR, tips: LIST, used: LIST, chunks: LIST, edits: EDITS },
  required: ["correct", "corrected", "natural", "tips", "used", "chunks", "edits"] };
