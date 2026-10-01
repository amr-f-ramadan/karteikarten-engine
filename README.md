# karteikarten-engine

Shared engine for two flashcard web apps on GitHub Pages:

- [de-karteikarten](https://github.com/amr-f-ramadan/de-karteikarten): German UI
- [eman-deutsch](https://github.com/amr-f-ramadan/eman-deutsch): Egyptian Arabic UI, right to left

Both apps load `/karteikarten-engine/app.js` and `/karteikarten-engine/app.css`, so a change here reaches both apps on the next Pages deploy.

The engine holds no personal data or settings: no texts, word lists, progress, colours or keys. Everything that belongs to one person lives in that person's app repo.

## What is here

- `app.js` + `app.js.map`: the built engine (do not edit; `npm run build` writes it from `src/`)
- `app.css`: glass design; colours, fonts and orb colours come from each app's `index.html`
- `src/core/`: pure logic, no DOM, shared with the tools: `text` (keys, slugs, stems), `leitner` (boxes, due and new cards), `progress` (merge, prune), `store` (card list with indexes: words, phrases, nouns, families, lookups, search text), `prompt` (Gemini requests and answer shapes), `diff` (marked corrections), `cardsfile` (cards.js read/append/rewrite)
- `src/services/`: browser I/O: `github` (contents API with ETag/304, progress branch, cards.js edits), `gemini` (text with model fallback, speech), `voice` (Gemini voice cache in IndexedDB with a size cap, device fallback), `push` (reminders), `sync` (progress sync), `local` (localStorage)
- `src/ui/`: `dom` (helpers, hold, loading ring), `parts` (HTML building blocks), `router` (render, action registry: `data-act` → handler, inputs by id), `views/` one module per tab
- `src/session.js` (learning queue), `src/vocab.js` (new cards, phrases, deletion, waitlist worker), `src/state.js`, `src/main.js` (wiring)
- `tools/remind.mjs`: daily reminder, run by each app's workflow from the app's folder; counts with `src/core`
- `tools/pending.mjs`: creates cards for the waitlist on GitHub (not scheduled); prompts and ids from `src/core`
- `tests/unit/`: `node --test` for the core modules; `tests/e2e.cjs`: browser test of both apps with GitHub and Gemini mocked
- `docs/PLAN.md`: the performance/scalability refactor, findings and steps

## What stays in each app

`index.html` (`window.APP`: repo, storage key, all UI texts in `t`, card `fields`, Gemini `rules` including `intro` and `end`, reminder texts in `remind`, push key `vapid`, speaking prompts in `practice`, and optionally `phrases` (fields, Gemini rules, starter-set prompt, new phrases per day); colours, fonts, icon), `cards.js`, `manifest.json`, `sw.js` (browsers require it in the app's own folder), the reminder workflow, and the progress on the app's `progress` branch.

## Phrases

With `window.APP.phrases` set, the list tab switches between words and phrases (openers, fillers, set phrases). Phrases are ordinary entries in `cards.js` with `"k":"p"` and `"g":"x"`, grouped by `cat` (what they are for). They are reviewed in the learning tab with their own daily limit for new ones (`newDay.p` in the progress), are left out of the article quiz, word families and practice words, and the + in speaking practice saves to them. Without `phrases` the app behaves as before.

## Working on the engine

```
npm install
npm run build     # src/ → app.js (commit app.js and app.js.map together with src/)
npm test          # build check, unit tests, browser suite
```

CI runs the same on every push; a push whose `app.js` is not the build of `src/` fails the check.

Adding a view: create `src/ui/views/<name>.js` exporting `create<Name>View(ctx)` → `{ mode, render, actions, change?, input?, keys?, enter?, after?, sayCard? }`, register it in `main.js`, add the tab button to each app's `index.html`. Actions are keyed by `data-act`; they receive the clicked element. Everything derived from the card list (families, topics, lookups) comes from `ctx.store`, which rebuilds its indexes after `push`, `remove` and `syncWith`.

The browser suite needs both apps checked out next to this repo (or `AMR_DIR` / `EMAN_DIR`):

The word lists are read from fixed commits of the two app repos (`PIN` in the test), so both checkouts need that history. For de-karteikarten the test compares against a SHA-256 of what its original engine produced (`tests/fixtures/amr-expected.sha256`). `tests/fixtures/sample-progress.json` is made-up data.
