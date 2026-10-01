// Gemini: Text (Karten, Übungen) mit JSON-Antwortform und Modell-Reihe, dazu Sprachausgabe.
export const MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.8-flash"];
const API = "https://generativelanguage.googleapis.com/v1beta/models";

function wav(pcm, rate) {
  const h = new DataView(new ArrayBuffer(44)), w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); h.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, "data"); h.setUint32(40, pcm.length, true);
  return new Blob([h.buffer, pcm], { type: "audio/wav" });
}

export function createGemini(getKey) {
  const post = (model, body, signal) => fetch(API + "/" + model + ":generateContent", {
    method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": getKey() }, body: JSON.stringify(body)
  });

  /* Fragt die Modelle der Reihe nach; ok(out) prüft die Antwort. Fehler: "key", "quota", "busy", "404", "leer", "model" */
  async function generate(prompt, schema, ok) {
    let last = "";
    for (const m of MODELS) {
      const r = await post(m, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 } });
      if (r.status === 404) { last = last || "404"; continue; }
      if (r.status >= 500) { last = last === "quota" ? "quota" : "busy"; await new Promise(res => setTimeout(res, 800)); continue; }
      if (r.status === 429) { last = "quota"; continue; }
      if (r.status === 400 || r.status === 403) throw new Error("key");
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const txt = (((j.candidates || [])[0] || {}).content || {}).parts;
      const out = JSON.parse(txt.map(p => p.text || "").join(""));
      if (!ok(out)) throw new Error("leer");
      return out;
    }
    throw new Error(last || "model");
  }

  /* Sprachmodelle des Schlüssels, die günstigsten zuerst: lite, dann flash, pro zuletzt */
  async function ttsModels() {
    const names = [];
    let page = "";
    for (let i = 0; i < 5; i++) {
      const r = await fetch(API + "?pageSize=200" + (page ? "&pageToken=" + encodeURIComponent(page) : ""), { headers: { "x-goog-api-key": getKey() } });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      (j.models || []).forEach(x => { if (/tts/i.test(x.name) && (x.supportedGenerationMethods || []).includes("generateContent")) names.push(x.name.replace(/^models\//, "")); });
      if (!(page = j.nextPageToken)) break;
    }
    const rank = n => (/lite/.test(n) ? 0 : /flash/.test(n) ? 1 : /pro/.test(n) ? 3 : 2);
    return names.sort((a, b) => rank(a) - rank(b));
  }

  /* Nur der Text geht an Gemini. Liefert { status, blob }; blob null bei Fehlerstatus */
  async function speech(model, text, voice, timeoutMs) {
    const cfg = Object.assign({ responseModalities: ["AUDIO"] }, voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } : {});
    const r = await post(model, { contents: [{ parts: [{ text }] }], generationConfig: cfg }, AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined);
    if (!r.ok) return { status: r.status, blob: null };
    const j = await r.json(), parts = ((((j.candidates || [])[0] || {}).content || {}).parts || []);
    const d = (parts.find(p => p.inlineData) || {}).inlineData;
    if (!d || !d.data) throw new Error("noaudio");
    const bytes = Uint8Array.from(atob(d.data), c => c.charCodeAt(0)), mime = d.mimeType || "";
    return { status: 200, blob: /pcm|l16/i.test(mime) ? wav(bytes, Number((mime.match(/rate=(\d+)/) || [0, 24000])[1])) : new Blob([bytes], { type: mime || "audio/wav" }) };
  }

  return { generate, ttsModels, speech };
}
