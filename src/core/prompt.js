// Aufträge und Antwortformen für Gemini. Die Regeln und Texte kommen aus window.APP (rules, phrases, practice).
const STR = { type: "STRING" };
const LIST = { type: "ARRAY", items: STR };

export const cardSchema = fields => ({ type: "OBJECT",
  properties: Object.fromEntries(fields.map(f => [f, f === "g" ? { type: "STRING", enum: ["der", "die", "das", "pl", "x"] } : STR])),
  required: fields.filter(f => f !== "perf" && f !== "note") });
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

export const PR_TASK = { type: "OBJECT", properties: { task: STR, starter: STR }, required: ["task", "starter"] };
const EDITS = { type: "ARRAY", items: { type: "OBJECT", properties: { wrong: STR, right: STR, kind: { type: "STRING", enum: ["error", "style"] } }, required: ["wrong", "right", "kind"] } };
export const PR_FB = { type: "OBJECT", properties: { correct: { type: "BOOLEAN" }, corrected: STR, natural: STR, tips: LIST, used: LIST, chunks: LIST, edits: EDITS },
  required: ["correct", "corrected", "natural", "tips", "used", "chunks", "edits"] };
