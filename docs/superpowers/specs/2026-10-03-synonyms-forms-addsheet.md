# Synonyms, one add sheet, word forms on one card, always-visible dock, more meaning-first cards

Date: 2026-10-03. Decisions by the user: add sheet behind a "+" in the header (not a seventh dock icon); existing
families are merged into one card; the form on the front is random; the one-time fill also adds synonyms and forms.

## 1. Synonyms (`syn`)

- Card field `syn`: one or two German synonyms as a comma string, from Gemini (rule `rules.syn`), in `APP.fields`.
- Shown as chips on the learn card's back and in the opened list row. A chip whose word is in the list opens that
  card (list) or is spoken (learn); a chip whose word is not in the list is spoken and offers nothing else (adding is
  a tap in the add sheet).

## 2. One add sheet

- A round "+" button in the header (engine-made, `inset-inline-end`, like the knob) opens a glass sheet with one
  input (German, English or Arabic). One Gemini request classifies and builds: `kind` "w" (word) or "p" (phrase) plus
  the fields of that kind (`core/prompt.anyPrompt`, `anySchema`: union of both field sets, `required` kind, w, ar,
  ex). The preview shows the kind as a tag and the fields of that kind (`f_*` for words, `pf_*` for phrases); saving
  writes to the right list. The waitlist chips live in the sheet; a word that Gemini cannot build is queued as before
  (phrases with `k: "p"`). The two list views lose their add sections; the phrases view keeps the starter set.
- The sheet is a router part (`registerPart`): its actions and inputs join the registry, it renders after every view,
  and it closes on Escape or the × button. `S.add` keeps the draft (survives a restart, rule 5.3).

## 3. Word forms (`forms`) and family merge

- Card field `forms`: the other parts of speech of the same family, each `{ w, g, pos, ar, en }` (`pos` n, v, adj, adv;
  `en` only with the field), from Gemini (rule `rules.forms`). Shown on the learn card's back and in the opened list
  row as a labelled list; the tested form is highlighted.
- Lernen: when a card is drawn, `L.face` is 0 (the base word) with probability 1/2, else a random form. The front
  shows that word (word first) or that word's meaning (meaning first); the back is the whole card. The speaker on the
  front says the shown form. Progress stays one Leitner box per card.
- Merge: families with more than one card (`fam`) become one card. Base: the member whose word equals the family key,
  else the shortest member containing it, else the first in list order. The others become forms (pos guessed from the
  article and the ending) and their cards are removed; the base keeps the highest box among the members (the entry
  with the highest `b`, ties by the earliest `due`); the others' progress and article-quiz entries are dropped.
  `core/newcard.mergeFamily` is pure; the fill applies it and writes `cards.js` once.

## 4. The one-time fill ("Karten ergänzen")

- Words without `en`, `syn` or `forms` are sent in batches of ten (`core/prompt.fillPrompt`, `FILL_SCHEMA`: id, en,
  syn, forms); phrases without `en` in batches of twenty (en only). Then the merge. Then one rewrite of `cards.js` and
  one progress change. The button under Daten names the number of cards it will touch; it stays while anything is
  missing; holds the app up to five minutes.

## 5. Always-visible dock (`dockStay`)

- Option in Aussehen: the pill stays open at its orientation (bottom middle or right middle), the knob is hidden, picks
  switch the view without closing, no idle timer, swipes and keys work as before. The main area gets room for it
  (bottom or right padding).

## 6. Meaning-first more often

- With "Bekannte Wörter: Bedeutung zuerst" on, a card is shown meaning first from box 1 on (before: box 2), with the
  meaning the "Bedeutung zeigen" option chooses (Arabic, English or both), for the drawn face.

## Apps

- de-karteikarten: `fields` + `syn`, `forms`; `rules.syn`, `rules.forms`; texts: `addH`, `addPh` (for the sheet),
  `kindW`, `kindP`, `synH`, `formsH`, `posN`, `posV`, `posAdj`, `posAdv`, `fill`, `fillBusy`, `fillDone`, `fillFail`
  (replace the `fillEn*` keys), `dockStay`, `close`. eman-deutsch: the same texts in Egyptian Arabic, no field change.
- Fingerprint changes on purpose (unified prompt and schema, form ids, saved line).

## Tests

- Unit: `anySchema`/`anyPrompt`, `shapeCard` with syn and forms, `fillPrompt`, `mergeFamily` (base choice, forms,
  progress), `pickFace` distribution bounds.
- E2E: Amr: the sheet classifies a word and a phrase (mocked by kind) and saves each to its list; the opened card shows
  synonym chips and forms; the fill rewrites every line with en, syn and forms and merges the six families (no family
  with two cards left, progress kept); Eman: the sheet in RTL with `tr`, the dock stays open with the option, Lernen
  shows a form on the front with a fixture card with forms.
