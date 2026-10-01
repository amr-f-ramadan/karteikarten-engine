# Refactoring plan: performance and scalability

Branch `refactor/performance`. Goal: the same two apps, the same look and behaviour, but an engine that stays
fast with thousands of cards and that new features can be added to without touching everything else.

## What the scan found

The engine is one 1060-line function (`app.js`) plus a stylesheet; the two Node tools re-implement parts of it.

### Performance (today ~90 cards, target: thousands)

| # | Where | Problem | Cost at N cards |
|---|-------|---------|-----------------|
| P1 | `render()` | Every state change rebuilds the whole view with `innerHTML`; `dueCards()`/`freshCards()` run twice per render | O(N) per tap, fine; but see P2 |
| P2 | `grouped()`, `renderList()`, `relatives()`, `topicOf()` | Each card filters the whole list again by family | O(N²): 2000 cards ≈ 4 million comparisons per list render |
| P3 | `.list li` | Every list row has `backdrop-filter: blur(24px)`; GPU compositing per row | thousands of blurred layers: stutter and heat on the phone |
| P4 | `renderList()` | All rows are always in the DOM, all topics expanded | one giant HTML string per render |
| P5 | `hay(c)`, `isDone`, `exists`, `existsP`, `waiting()` | Search text rebuilt per render; linear scans per pending entry | O(N × pending) per render |
| P6 | `refreshCards()`, `pull()` | Full `cards.js` / `progress.json` downloaded as base64 on every app start and every 5 minutes, even when nothing changed | 1 MB cards file → 1.4 MB base64 every time |
| P7 | `changed()` / `push()` | Whole progress serialized on every answer and pushed as one blob; `pending` entries never pruned | grows for ever; fine up to ~5000 cards |
| P8 | `cards.js` | One blocking classic script, parsed before the engine runs | 1 MB blocks first paint |
| P9 | voice cache | IndexedDB holds raw 24 kHz WAV for ever; no limit | ≈ 50 KB per second of speech; 2000 sentences ≈ 300 MB |
| P10 | `famList()` in the Gemini prompt | Every card family is listed in every new-card request | prompt grows linearly with vocabulary → tokens |
| P11 | `byId` | Built on start but never used; `CARDS.find/some` everywhere | linear scans |

### Scalability (adding vocabulary and features)

| # | Problem |
|---|---------|
| S1 | One closure with ~40 shared mutable variables; the click handler is a 35-branch `if/else` chain; adding a feature touches state, render and dispatcher at once |
| S2 | `tools/remind.mjs` and `tools/pending.mjs` copy prompt building, slug, family and due-counting logic from `app.js` (three places to change) |
| S3 | `cards.js` is edited by string surgery in three places (`putCards`, `removeCard`, `pending.mjs`) |
| S4 | No unit tests: only the browser e2e (74 checks, ~2 minutes) guards everything |
| S5 | No build/CI in the engine repo; a broken push reaches both phones immediately |
| S6 | Views are template strings with helpers scattered through the file (`speakBtn`, `wordHTML`, `famRow`, `dotsOf`, …) |

## Constraints that stay

- Both apps load exactly `/karteikarten-engine/app.js` and `app.css` (with `?v=` cache busting). The apps' `index.html`,
  `cards.js` format, `progress` branch format and GitHub Actions workflows stay as they are, so no app change is needed
  for this refactor and the engine can be rolled back by reverting one commit.
- No framework, no runtime module loading: the bundle stays one classic script (one request on the phone).
- All personal content stays in the apps (`window.APP`); the engine stays free of texts, colours, keys.
- The e2e suite must stay green, and the recorded de-karteikarten fingerprint must only change where a step says so.

## Target structure

```
src/
  core/        pure, no DOM, shared with the Node tools
    text.js      esc, norm, plainDe, slug, pkey, sameStem, topicOf, famKey, fullWord, fill
    leitner.js   INT, due/fresh selection, answer(), newToday
    progress.js  emptyP, merge, prune, load/save adapters
    store.js     CardStore: words/phrases/nouns, byId, byFam, byTopic, search text; invalidated on change
    prompt.js    prompt + schema builders for cards, phrases, starter set, practice
    diff.js      tokens, diffHTML (corrections)
  services/    browser I/O, no rendering
    github.js    contents API with ETag/304, progress push/pull, cards.js append/remove, branch creation
    gemini.js    generateContent with model fallback, voice generation
    voice.js     speak(): Gemini voice cache (IndexedDB, size cap) + device fallback, loading ring, hold
    push.js      reminders (service worker, VAPID, push.json)
  ui/
    dom.js       $, html helpers (speakBtn, wordHTML, chip, dots), flash, hold
    router.js    mode, render(), action registry (data-act → handler)
    views/       learn.js, quiz.js, list.js, phrases.js, practice.js, settings.js
  main.js      bootstrap: config, state, wiring
build.mjs      esbuild → app.js (iife); --check verifies app.js matches src
tests/unit/    node --test for core/
tests/e2e.cjs  unchanged browser suite
tools/         import from src/core instead of copying
```

## Steps

Each step ends with `npm test` green (build check, unit tests, 74 e2e checks).

1. **Tooling** (S4, S5): `package.json`, esbuild bundle `src/ → app.js`, `--check`, GitHub Action running build check + unit tests on every push and PR.
2. **Split without behaviour change** (S1, S6): move code into the modules above; bundle must pass all e2e checks with the de-karteikarten fingerprint unchanged.
3. **Card store with indexes** (P2, P5, P11): one `CardStore` with cached `words`, `phrases`, `nouns`, `byId`, `byFam`, `byTopic`, precomputed search text; every mutation (add, remove, refresh) goes through it and invalidates. List rendering becomes O(N).
4. **Render cost** (P1, P3, P4): derived counts computed once per render; list rows lose `backdrop-filter` (flat translucent glass, same colours); topics collapse by default above 150 cards, search expands; `.hold`/loading state no longer re-queries the whole DOM.
5. **Network** (P6): `cards.js` and `progress.json` fetched with `If-None-Match`; a 304 costs no rate limit and no download, so `refreshCards` needs no separate check of the `main` commit (the contents ETag changes with the file).
6. **Progress hygiene** (P7): `done` pending entries older than 30 days pruned on merge; `writeLocal` debounced through `requestIdleCallback`/timeout so answering stays instant.
7. **Voice cache cap** (P9): IndexedDB entries carry a timestamp; above 150 MB (estimate from blob sizes) the oldest are dropped.
8. **Prompt size** (P10): only families whose stem overlaps the new word are listed (topics stay complete, they are few). Changes the de-karteikarten fingerprint on purpose.
9. **Tools share core** (S2, S3): `remind.mjs` counts due/fresh with `core/leitner`, `pending.mjs` builds prompts and ids with `core/prompt` + `core/text` and appends through the same serializer the app uses.
10. **Docs**: README architecture section, this plan kept as the record.

Deferred (not in this branch, noted for later): `cards.js` → JSON (would change both app repos and Git history of the
word lists); loading `cards.js` with `defer` (needs an app change, tiny win); compressing voice audio.

## Status

Done on this branch: steps 1 to 10. Measured on the bundle: 70 KB → 52 KB minified (one request as before);
list rendering O(N) through the store indexes; list rows without `backdrop-filter`; topics collapse above 150 rows;
`cards.js` and `progress.json` are re-downloaded only when GitHub reports a change (ETag); done waitlist entries
pruned after 30 days; voice cache capped at 150 MB; the new-card prompt lists only families with a matching stem
(the de-karteikarten fingerprint was updated for exactly that line); the tools count and prompt with `src/core`.

Not changed, on purpose: `writeLocal` stays synchronous (iOS can end a home-screen app at any moment; a debounce
could lose the last answer); `cards.js` stays a JS file (format change would touch both app repos and their history).

Changed afterwards: the five-button tab bar became the lens dock (one knob, a pill that rises and is swiped; see
`docs/superpowers/specs/2026-10-01-lens-dock-design.md`); the apps' `<nav>` markup stayed as it was.

Resolved afterwards: the app's "today" for daily limits was the UTC date (`toISOString`) while the reminder tool
used the phone's time zone, so between midnight and 02:00 local time the two disagreed by a day. Now both use
`core/text.today(tz)`: the device's local date in the app, the zone from `push.json` in the reminder.
