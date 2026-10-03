// Wörterliste nach Themen, Wortfamilien zusammen; Suche. Neue Karten entstehen im Eingabeblatt (addsheet), die Wendungen haben
// ihre eigene Ansicht.
import { esc, fullWord, topicOf, gClass } from "../../core/text.js";
import { boxOf, learnedCount } from "../../core/leitner.js";
import { wordHTML, dots, topicSection, searchBox, famRow, exRow, trLine, meaningLines, meaningMode, synRow, formsRow } from "../parts.js";
import { COLLAPSE_AT, closedSet, listActions } from "../listing.js";

export function createListView(ctx) {
  const { S, T, store, vocab } = ctx;

  function renderWords() {
    const topics = new Map();
    let famTopic = null;
    store.grouped().forEach(([c, sub, inFam]) => {
      if (!sub) famTopic = topicOf(store.family(c)) || T("newCat");
      if (!topics.has(famTopic)) topics.set(famTopic, []);
      const open = S.list.open === c.id;
      topics.get(famTopic).push(`<li class="${gClass(c)}${sub ? " sub" : ""}${inFam ? " infam" : ""}" data-s="${esc(store.hay(c))}"><button class="row" data-act="open" data-id="${c.id}">
        ${wordHTML(c)}${dots(boxOf(S.P, c), T)}</button>
        ${open ? `<div class="detail">${meaningLines(c, meaningMode(ctx))}${c.perf ? `<p class="perf de">${T("perfL")} <b>${esc(c.perf)}</b></p>` : ""}${exRow(c.ex, T("sayEx"))}${trLine(c.tr)}${formsRow(c, 0, T)}${synRow(c, store, T, "goto")}${famRow(store.relatives(c), T)}<div class="row2"><button class="btn" data-act="sayt" data-t="${esc(fullWord(c))}">${T("phSay")}</button><button class="btn again" data-act="del" data-id="${c.id}">${T("delCard")}</button></div></div>` : ""}</li>`);
    });
    const words = store.words, closed = words.length > COLLAPSE_AT ? closedSet(S, "w", [...topics.keys()]) : null;
    const secs = [...topics.entries()].map(([t, rows]) => topicSection(t, rows, closed ? closed.has(t) : null)).join("");
    return `${searchBox(S.list.query, T)}
      <p class="meta">${T("listStat").replace("{a}", learnedCount(words, S.P)).replace("{t}", words.length)}</p>${secs}<p id="nohits" class="meta dim" hidden>${T("noHits")}</p>`;
  }
  const shared = listActions(ctx);
  return {
    mode: "list", render: renderWords, enter: shared.enter, after: shared.after, input: shared.input,
    actions: Object.assign({ del: el => vocab.deleteCard(el.dataset.id) }, shared.actions)
  };
}
