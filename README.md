# karteikarten-engine

Shared engine for two flashcard web apps on GitHub Pages:

- [de-karteikarten](https://github.com/amr-f-ramadan/de-karteikarten): German UI
- [eman-deutsch](https://github.com/amr-f-ramadan/eman-deutsch): Egyptian Arabic UI, right to left

Both apps load `/karteikarten-engine/app.js` and `/karteikarten-engine/app.css`, so a change here reaches both apps on the next Pages deploy.

The engine holds no personal data or settings: no texts, word lists, progress, colours or keys. Everything that belongs to one person lives in that person's app repo.

## What is here

- `app.js`: learning (Leitner boxes), article quiz, pronunciation, GitHub sync, backup, new words with Gemini, waitlist, word families, topics, search, reminders
- `app.css`: glass design; colours, fonts and orb colours come from each app's `index.html`
- `tools/remind.mjs`: daily reminder, run by each app's workflow from the app's folder
- `tools/pending.mjs`: creates cards for the waitlist on GitHub (not scheduled)
- `tests/e2e.cjs`: browser test of both apps with GitHub and Gemini mocked

## What stays in each app

`index.html` (`window.APP`: repo, storage key, all UI texts in `t`, card `fields`, Gemini `rules` including `intro` and `end`, reminder texts in `remind`, push key `vapid`; colours, fonts, icon), `cards.js`, `manifest.json`, `sw.js` (browsers require it in the app's own folder), the reminder workflow, and the progress on the app's `progress` branch.

## Before changing the engine

Check out both apps next to this repo and run:

```
node tests/e2e.cjs
```

The word lists are read from fixed commits of the two app repos (`PIN` in the test), so both checkouts need that history. For de-karteikarten the test compares against a SHA-256 of what its original engine produced (`tests/fixtures/amr-expected.sha256`). `tests/fixtures/sample-progress.json` is made-up data.
