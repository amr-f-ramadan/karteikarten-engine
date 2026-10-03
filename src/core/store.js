// Kartenbestand mit Indizes. Alle Änderungen an der Liste laufen hier durch (push, remove, syncWith),
// die Indizes werden danach beim nächsten Zugriff neu gebaut. Ohne DOM, auch für die Node-Werkzeuge.
import { isP, isNoun, famKey, norm, fullWord, pk, wordKey, sameStem } from "./text.js";

export class CardStore {
  constructor(cards) { this.all = cards; this._i = null; this._hay = new WeakMap(); }
  touch() { this._i = null; }
  get idx() {
    if (this._i) return this._i;
    const words = [], phrases = [], nouns = [], byId = new Map(), byFam = new Map(), byWord = new Set(), bySrc = new Set(), byPk = new Set();
    for (const c of this.all) {
      byId.set(c.id, c); byWord.add(c.w.toLowerCase()); byPk.add(pk(c.w)); if (c.src) bySrc.add(c.src);
      if (isP(c)) { phrases.push(c); continue; }
      words.push(c); if (isNoun(c)) nouns.push(c);
      const k = famKey(c), f = byFam.get(k); if (f) f.push(c); else byFam.set(k, [c]);
    }
    return (this._i = { words, phrases, nouns, byId, byFam, byWord, bySrc, byPk });
  }
  get words() { return this.idx.words; }
  get phrases() { return this.idx.phrases; }
  get nouns() { return this.idx.nouns; }
  byId(id) { return this.idx.byId.get(id) || null; }
  hasId(id) { return this.idx.byId.has(id); }
  /* Wortfamilie einer Karte in Listenreihenfolge (Wendungen haben keine) */
  family(c) { return isP(c) ? [c] : this.idx.byFam.get(famKey(c)) || [c]; }
  relatives(c) { return this.family(c).filter(x => x !== c); }
  hasFam(k) { return this.idx.byFam.has(k); }
  famMembers(k) { return this.idx.byFam.get(k) || []; }
  famList() { return [...this.idx.byFam.keys()].join(", "); }
  /* Nur Familien, deren Stamm zum neuen Wort passt (so wie saveCard sie auch annimmt); der Auftrag wächst nicht mit dem Wortschatz */
  famListFor(word) { const keys = [...this.idx.byFam.keys()].filter(k => sameStem(word, k) || sameStem(k, word)); return keys.length ? keys.join(", ") : "keine"; }
  topicList() { return [...new Set(this.words.map(c => c.cat).filter(Boolean))].join(", "); }
  phraseGroups() { return [...new Set(this.phrases.map(c => c.cat).filter(Boolean))].join(", "); }
  /* Schon vorhanden? Wörter ohne Artikel verglichen, Wendungen ohne Satzzeichen */
  exists(w) { return this.idx.byWord.has(wordKey(w)); }
  existsP(w) { return this.idx.byPk.has(pk(w)); }
  /* Wartelisten-Eintrag erledigt: das Wort oder seine Quelle (src) ist in der Liste */
  isDone(k) { return this.idx.byWord.has(k) || this.idx.bySrc.has(k); }
  /* Suchtext einer Karte, einmal gebaut */
  hay(c) { let h = this._hay.get(c); if (h === undefined) { h = norm([fullWord(c), c.ar, c.en, c.hint, c.def, c.ex, c.tr, c.cat, c.fam, c.perf].join(" ")); this._hay.set(c, h); } return h; }
  push(c) { this.all.push(c); this.touch(); }
  /* Felder einer Karte ändern (id, Wort und Art bleiben: die Indizes gelten weiter, nur der Suchtext nicht) */
  patch(id, fields) { const c = this.byId(id); if (!c) return false; Object.assign(c, fields); this._hay.delete(c); return true; }
  remove(id) { const i = this.all.findIndex(c => c.id === id); if (i >= 0) this.all.splice(i, 1); this.touch(); return i >= 0; }
  /* Stand aus GitHub übernehmen: verschwundene Karten raus, neue hinten dran; gibt die neuen zurück */
  syncWith(list) {
    const known = this.idx.byId, fresh = list.filter(c => !known.has(c.id)), ids = new Set(list.map(c => c.id));
    for (let i = this.all.length - 1; i >= 0; i--) if (!ids.has(this.all[i].id)) this.all.splice(i, 1);
    fresh.forEach(c => this.all.push(c));
    this.touch();
    return fresh;
  }
  /* Wörter in Listenreihenfolge, jede Familie zusammen: [Karte, istUnterzeile, inFamilie] */
  grouped() {
    const out = [], seen = new Set();
    for (const c of this.words) {
      if (seen.has(c.id)) continue;
      const fam = this.family(c);
      fam.forEach((x, i) => { seen.add(x.id); out.push([x, i > 0, fam.length > 1]); });
    }
    return out;
  }
}
