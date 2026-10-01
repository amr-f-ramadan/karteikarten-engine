// Aussprache: Gemini-Stimme, jeder Text nur einmal erzeugt und im Gerät gespeichert (IndexedDB, für beide Apps gemeinsam);
// klappt es nicht, spricht die Stimme des Geräts. Solange eine neue Aussprache entsteht: Ring am Knopf und Sperre.
import { HOLD_MS, hold, isHolding, setLoading, stopLoading, plain } from "../ui/dom.js";

const SILENT = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";
const MK = "kk-voice:model"; // gewähltes Sprachmodell, für alle Apps gleich

export function createVoice({ gemini, getKey, opt, local, voice }) {
  const hasTTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let deVoice = null;
  function pickVoice() { const v = speechSynthesis.getVoices(); deVoice = v.find(x => x.lang === "de-DE") || v.find(x => (x.lang || "").toLowerCase().startsWith("de")) || null; }
  if (hasTTS) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speakLocal(text) {
    if (!hasTTS) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-DE"; if (deVoice) u.voice = deVoice;
      u.rate = opt("slow", false) ? 0.7 : 0.95;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  const player = typeof Audio === "function" ? new Audio() : null;
  const VOICE = voice || "Kore";
  const gemVoice = () => !!getKey() && opt("gvoice", true) && !!player && "indexedDB" in window;
  let vdb = null;
  const db = () => vdb || (vdb = new Promise((res, rej) => { const r = indexedDB.open("kk-voice", 1); r.onupgradeneeded = () => r.result.createObjectStore("a"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const dbGet = k => db().then(d => new Promise(res => { const q = d.transaction("a").objectStore("a").get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); })).catch(() => null);
  const dbPut = (k, v) => db().then(d => new Promise(res => { const t = d.transaction("a", "readwrite"); t.objectStore("a").put(v, k); t.oncomplete = t.onerror = () => res(); })).catch(() => {});

  async function ttsModel() {
    const m = local.get(MK);
    if (m) return m;
    const names = await gemini.ttsModels();
    if (!names.length) throw new Error("notts");
    local.set(MK, names[0]);
    return names[0];
  }
  async function genAudio(text) {
    const m = await ttsModel();
    let r = await gemini.speech(m, text, VOICE, HOLD_MS);
    if (r.status === 400) r = await gemini.speech(m, text, "", HOLD_MS);
    if (r.status === 404) local.remove(MK);
    if (!r.blob) throw new Error(String(r.status));
    return r.blob;
  }

  const making = new Map();
  let turn = 0, lastUrl = "";
  function speakGem(text, btn) {
    const my = ++turn, key = VOICE + "|" + text;
    stopLoading();
    try { if (hasTTS) speechSynthesis.cancel(); } catch (e) {}
    // iOS erlaubt Ton nur direkt beim Tippen: den Player jetzt mit Stille starten, den echten Ton gleich danach
    player.pause(); player.src = SILENT; player.play().catch(() => {});
    (async () => {
      let blob = await dbGet(key);
      if (!blob) {
        if (my === turn) { setLoading(btn); hold(true); }
        if (!making.has(key)) making.set(key, genAudio(text).then(b => { dbPut(key, b); return b; }).finally(() => making.delete(key)));
        blob = await making.get(key);
      }
      if (my !== turn) return;
      stopLoading(); if (isHolding()) hold(false);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      player.src = lastUrl = URL.createObjectURL(blob);
      player.playbackRate = opt("slow", false) ? 0.75 : 1;
      await player.play();
    })().catch(() => { if (my === turn) { stopLoading(); if (isHolding()) hold(false); speakLocal(text); } });
  }
  /* text darf HTML enthalten (Beispielsätze mit <b>); btn ist der getippte Knopf für den Ring */
  function speak(text, btn) {
    const t = plain(text);
    if (!t) return;
    if (gemVoice()) speakGem(t, btn); else speakLocal(t);
  }
  return { speak };
}
