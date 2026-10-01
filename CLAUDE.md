# Rules for working on karteikarten-engine

Binding for every change in this repository and, where they concern the apps, in `de-karteikarten` and
`eman-deutsch`. Read `README.md` (structure) and `docs/PLAN.md` (why things are built this way) first.
When a rule here conflicts with a convenient shortcut, the rule wins. When two rules conflict, ask.

## 1. What the engine is and is not

1.1 The engine is shared by two apps. It contains **no personal content**: no UI texts, no colours, no fonts,
    no word lists, no progress, no keys, no language. Everything personal lives in the app's `index.html`
    (`window.APP`), `cards.js`, `manifest.json`, `sw.js` and the app's `progress` branch.
1.2 Every user-visible string goes through `T(key)`. A new string means a new key in **both** apps'
    `window.APP.t` (German for de-karteikarten, Egyptian Arabic with feminine forms for eman-deutsch). Never
    hard-code a German fallback in the engine; the e2e check "No German UI text in any captured state" exists
    to catch exactly that.
1.3 Each app keeps its identity: title, header, home-screen name, icon, palette, `lang`/`dir`, storage key
    (`kk-amr-v2`, `kk-eman-v2`). The engine must work in `dir="rtl"`: logical CSS properties
    (`inset-inline-*`, `margin-inline-*`), `dir="auto"` on inputs, `dir="ltr"` only on German text (`.de`).
1.4 Features are switched on by configuration in `window.APP` (for example `phrases`, `practice`, `voice`),
    never by checking which app is running. Without the configuration the engine behaves as before.
1.5 Both apps load exactly `/karteikarten-engine/app.js` and `app.css` with a `?v=` cache buster. Do not
    rename, split into runtime modules, or add a second script: the phone loads one file.

## 2. Code structure

2.1 Source lives in `src/`. `app.js` and `app.js.map` are build output (`npm run build`); never edit them
    by hand; commit them together with the `src/` change. `npm run check` must pass.
2.2 Layers and their only allowed dependencies:
    - `src/core/`: pure functions and the `CardStore`. No DOM, no `fetch`, no `localStorage`, no `window`.
      Must run in Node (the tools import it). Unit-tested.
    - `src/services/`: browser I/O (GitHub, Gemini, voice, push, sync, localStorage). May import `core` and
      `ui/dom.js` (for `hold`/loading state), nothing from `ui/views`.
    - `src/ui/`: rendering and events. `parts.js` holds reusable HTML pieces; `views/<mode>.js` one per tab;
      `router.js` dispatches `data-act` actions and inputs by id.
    - `src/main.js` wires everything through the `ctx` object; views and services get what they need from
      `ctx`, never from globals.
2.3 Mutable runtime state lives in `src/state.js` (`S`). Do not add module-level `let` state in views.
    Persistent state is the progress `P` (synced) or `localStorage` through `ctx.local` (device only).
2.4 Everything derived from the card list (words, phrases, nouns, families, topics, lookups, search text)
    comes from `ctx.store`. Never filter `store.all` in a loop over cards (that is the O(N²) the refactor
    removed). Every mutation of the list goes through `store.push`, `store.remove`, `store.syncWith`.
2.5 A new tab: `src/ui/views/<name>.js` exporting `create<Name>View(ctx)` →
    `{ mode, render, actions, change?, input?, keys?, enter?, after?, sayCard? }`, registered in `main.js`,
    plus the tab button in both apps' `index.html`. New user actions are entries in `actions`, keyed by
    `data-act`; no new `if (act === …)` chains anywhere.
2.6 Logic the tools need (prompts, ids, families, due counting, cards.js read/write) lives in `src/core`
    and is imported by `tools/*.mjs`. Never copy it.
2.7 No frameworks, no runtime dependencies. Dev dependencies only for build and tests, pinned versions.
    Target browsers: Safari 15+ (iOS home-screen app) and current Chrome.

## 3. Clean code

3.1 Functions do one thing and are short enough to read without scrolling; names say what they return or do
    (`dueCards`, `famListFor`, `existsP`), no abbreviations that need a comment to decode. Booleans read as
    questions (`isP`, `hasFam`).
3.2 No duplication: the second copy of a template or a check becomes a helper in `parts.js` or `core`.
3.3 Comments explain **why** (a Safari quirk, an iOS rule, a GitHub API behaviour), not what the code
    already says. Comments in the engine are German, like the existing ones. Keep the comment density of the
    surrounding file.
3.4 Escape everything that comes from users, Gemini or the card data before it goes into HTML (`esc`),
    except fields that are HTML by design (`ex`, `def`, `note`, which may contain `<b>`).
3.5 Fail quietly where the user cannot act (storage, badge, voice fallback) and visibly where they can
    (toast via `flash` with a translated text). Never swallow an error that leaves the UI in a busy state:
    every `busy`/`hold(true)` has a matching reset on all paths, including `catch`.
3.6 Accessibility: `aria-label` on icon-only buttons, `aria-busy` while loading, `aria-current` on the active
    tab, `aria-pressed` on toggles, `role="status"` for the toast. Respect `prefers-reduced-motion` for every
    animation.
3.7 CSS: tokens come from the app (`--ink`, `--accent`, `--glass`…); the engine defines no colours except
    with a fallback (`var(--sty, #2F6FD0)`). Keep selectors flat; one rule per concern; no `!important`
    except the existing iOS zoom rule.

## 4. Performance budget

4.1 Rendering a view is O(N) in the number of cards; derived counts are computed once per render
    (`session.count()`), not per element.
4.2 No `backdrop-filter` on repeated elements (list rows, chips). It is fine on cards, the tab bar and
    panels.
4.3 Long lists stay usable at thousands of rows: topics collapse above `COLLAPSE_AT`, search opens matches.
    Anything new that lists cards follows the same pattern or paginates.
4.4 Network: read GitHub files through `github.fetchFile` (ETag/304). Never download `cards.js` or
    `progress.json` unconditionally in a loop or timer.
4.5 Storage: anything cached on the device has a cap and an eviction rule (voice cache: 150 MB, oldest
    first). Progress stays small: prune what is finished (`prune`).
4.6 Gemini tokens: send only what the request needs. Voice requests carry the text alone; card prompts list
    only families with a matching stem (`store.famListFor`), topics in full; every voice is generated once
    and cached. Do not add instructions to a prompt "just in case".
4.7 The bundle stays one request and under ~60 KB minified. A dependency that would exceed that needs a
    reason written in the PR.

## 5. Waiting, feedback and interruptions (how the app must feel)

5.1 Any step that can take longer than a moment (Gemini text, voice generation, GitHub writes, deleting)
    shows that it is running **and** blocks the main area until it finishes or times out: `hold(true, ms)`
    with `SLOW_MS` for text, `HOLD_MS` for voice, and a visible state on the control that was tapped
    (loading ring on speakers via `setLoading(btn)`, `disabled` + busy text on buttons). The tab bar stays
    usable. Never leave the user able to start the next thing while the previous one is unfinished.
5.2 Every wait has a timeout after which the app recovers on its own (fallback voice, error toast); nothing
    stays locked.
5.3 Work in progress survives closing the app: anything the user typed or started (a practice exercise, a
    half-filled card form) is saved to `localStorage` as it changes and restored on start.
5.4 Audio on iOS must start inside the tap (silent player first, real audio after). Keep that pattern for
    any new sound.
5.5 Speaker buttons sit on the same line as the text they read and never overlap it. Use `sayT`/`speakBtn`
    from `parts.js`; do not hand-write the SVG.

## 6. Data

6.1 `cards.js` stays `window.CARDS = [ … ]`, one card per line, appended through `appendCards` (small Git
    diffs), rewritten only when deleting (`serializeCards`). Ids are `slug(w)` with a numeric suffix when
    taken; `src` records the waitlist key a card came from; phrases carry `k: "p"`, `g: "x"`.
6.2 Card fields per app come from `window.APP.fields` / `phrases.fields`. A new field: add it to the rules
    (`APP.rules`), the schema (`core/prompt.js`), the form (`list.js`), the display, the search text
    (`store.hay`) and, if the tools create cards, to `pending.mjs` through `core`.
6.3 Progress is `{ v: 1, cards, art, pending, newDay, opts, updated }`. Merging is by newest timestamp per
    entry (`core/progress.merge`); never overwrite a device's progress with an older copy. A format change
    bumps `v` and adds a migration in `loadP`; old data is never dropped silently.
6.4 Words and phrases are separate lists: phrases are excluded from the article quiz, word families, practice
    word picks and the word count; they have their own daily limit (`newDay.p`). Anything new that iterates
    cards decides explicitly which kind it means (`store.words`, `store.phrases`, `store.all`).
6.5 Example sentences (`ex`) use the target word in the form the sentence needs, every part in `<b>`, whole
    words only, grammatically correct; the Gemini rules in both apps say so. Notes never refer to the
    scanned sheet; they explain usage or a trap.
6.6 Gemini corrections in practice distinguish `error` from `style`; the marked answer shows both kinds in
    different colours with a legend. Colours for new states must be distinct from the app's accent (Eman's
    accent is teal, close to the "correct" green).

## 7. Reminders and tools

7.1 `tools/remind.mjs` and `tools/pending.mjs` run in GitHub Actions **from the app folder** with the engine
    checked out as `.engine/`. They execute the inline `<script>` blocks of the app's `index.html` in Node:
    every inline script in an app must be plain, side-effect-free configuration that runs under `vm`
    without `document`; loader scripts carry `data-loader` so they are skipped.
7.2 The reminder fires once per day per configured time (`sent.json` `{ d, at }`), waits up to 20 minutes
    for the exact minute, and is triggered by GitHub's schedule plus cron-job.org at :14/:29/:44/:59. Any
    change here is smoke-tested against a throwaway repo (see the PR history) for both apps.
7.3 Message texts come from `APP.remind` and `APP.t.appName`; counts come from `core/leitner`, the same
    functions the app uses.

## 8. Secrets and safety

8.1 Never commit a token, API key, VAPID private key or push subscription. Keys the user pastes in chat are
    used only for the task at hand, kept in the scratchpad, deleted afterwards, and the user is told to
    rotate them. Public VAPID keys and repo names are fine.
8.2 Nothing from Gemini, GitHub or a card is executed; `parseCards` runs `cards.js` only because it is the
    user's own file from their own repo. Do not extend that to other inputs.
8.3 No analytics, no third-party scripts, no fonts beyond the Google Fonts the apps already load.

## 9. Testing and verification

9.1 Before every push: `npm test` (build check, unit tests, browser suite) green, and the real result stated
    in the message: "78/78" means it ran, not that it should pass. Never report a test as passed that was not
    run; if a step was skipped, say so.
9.2 Pure logic gets a unit test in `tests/unit/`. User-visible behaviour gets a check in `tests/e2e.cjs`
    for eman-deutsch (RTL, Arabic) and, when it touches card creation, for de-karteikarten.
9.3 The de-karteikarten fingerprint (`tests/fixtures/amr-expected.sha256`) changes only on purpose: record
    the run before and after (`DUMP_RUN=<file>`), diff them, confirm only the intended line changed, then
    update the hash and say so in the commit.
9.4 Anything that cannot be verified here (a real iPhone, Safari-only rendering, real Gemini output quality,
    push delivery) is named as unverified when reporting, with what to try on the phone.
9.5 CI (`.github/workflows/ci.yml`) must be green on the branch before a PR is proposed for merge.

## 10. Git and delivery

10.1 Work on a branch; open a PR against `main` with a body that says what changed, what was tested (with
     numbers) and what was deliberately not changed. Merge only when the user says so; GitHub Pages serves
     `main`, so a merge reaches both phones within minutes.
10.2 One concern per commit; a refactor with no behaviour change is its own commit before the behaviour
     change. Commit messages say why; model identifiers never appear in commits, PRs or code.
10.3 A change to the engine that needs an app change (new `t` keys, a new tab, a new field) is delivered as
     matching PRs in the app repos, merged in the same step, so no phone runs an engine newer than its
     configuration.
10.4 Keep `docs/PLAN.md` honest: when a listed item changes, update the status.

## 11. When unsure

Say what is uncertain (iOS behaviour, Gemini model names, pricing, API details) instead of guessing; verify in
code or tests where possible; otherwise ask a short, specific question before building on an assumption.
