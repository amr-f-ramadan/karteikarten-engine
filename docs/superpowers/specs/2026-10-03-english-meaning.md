# English meaning next to the Arabic one

Date: 2026-10-03. Request: "Add also the english translation alongside the arabic one. Let me choose between them (or both
of them) in the settings."

## Field

- New optional card field `en` (short English meaning), enabled per app by listing it in `APP.fields` and
  `APP.phrases.fields` (rule 6.2): the Gemini schema takes it from the fields, the rule text comes from `APP.rules.en`
  and `APP.phrases.rules.en`, the forms show it (`f_en`, `pf_en`), the search text includes it, `shapeCard` writes it
  after `ar` in `cards.js`. de-karteikarten has it; eman-deutsch does not (its texts are added anyway, rule 1.2).
- The de-karteikarten fingerprint changes on purpose: the form has `f_en`, the request carries the `en` rule and schema
  property, the saved line carries `en`.

## Option

- `meaning` in the progress options (synced): `ar` (default), `en`, `both`; a select in the Lernen group, shown only
  when the app has the field. `parts.meaningLines` and `parts.meaningBig` render the meaning on the learn card (front for
  known cards, back), the article quiz and the opened rows of both lists. A card without `en` falls back to Arabic.

## Old cards

- A one-time button in the Daten group, "Englische Bedeutungen ergänzen (N Karten)", shown while cards lack `en`. It
  asks Gemini in batches of twenty (only id, word and Arabic per card, the app's `en` rule; `core/prompt.enPrompt`,
  `EN_SCHEMA`), then rewrites `cards.js` once with `en` after `ar` in each line (`core/newcard.withEn`,
  `serializeCards`) and patches the cards in the store (`store.patch`). Needs the Gemini key and the token on the
  device; holds the app while it runs (up to 3 minutes), reports the count in a toast, fails visibly.

## Tests

- Unit: `shapeCard` with and without the field, `withEn` key order, `enPrompt` text, `EN_SCHEMA`, `store.patch` and the
  search text.
- E2E (Amr): the opened card shows both meanings with "both"; the fill button names the number of old cards, Gemini is
  asked ceil(N/20) times, every line of the written `cards.js` has `en` right after `ar`, the new card keeps its own
  `en`, an old card shows its English afterwards. (Eman): no option and no fill button without the field.
- Not verifiable here: the quality of Gemini's English, the fill on the real list (about 120 cards, 6 requests).
