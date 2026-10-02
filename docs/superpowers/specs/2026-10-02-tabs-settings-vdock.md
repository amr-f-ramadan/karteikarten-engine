# Phrases as a tab, grouped settings, card wipe, vertical dock

Date: 2026-10-02. Five requests from use on the phone, delivered as one engine PR with matching app PRs.

## 1. Wörter and Wendungen as separate dock icons

- The list tab no longer carries the words/phrases switch (`.seg`, `lk`). The phrase list is its own view
  `src/ui/views/phrases.js` → `createPhrasesView(ctx)` with `mode: "phrases"`, registered in `main.js` only when
  `APP.phrases` is configured (rule 1.4). Both apps add `<button data-mode="phrases">` to their `<nav>` (label
  "Wendungen" / "العبارات", a quotation-marks icon). The dock loops over six items.
- What the two views share (`COLLAPSE_AT`, the closed-topics set, the search filter) lives in `src/ui/listing.js`.
  `S.list` keeps `open`, `query`, `closed: { w, p }`; the kind is the view. Entering a view clears `open` and `query`.
- Without a `phrases` button in the nav nothing breaks: the view is simply unreachable.

## 2. The label disappears as the pill collapses

On closing, the dock sets every label's opacity to 0 at once (`nav:not(.open) .lbl` fades in 0.15 s), so no label is
left under the icon while the pill falls into the knob.

## 3. An opened card wipes down

`.detail` (the opened row's card in the word and phrase lists) animates in: `clip-path` from `inset(0 0 100% 0)` to
`inset(0)` with a short fade and a 6 px slide, 0.35 s with the pill's ease. Under reduced motion no animation.
Browsers without animatable `clip-path` still get the fade and slide.

## 4. "Einstellungen", grouped

- de-karteikarten renames the tab "Optionen" → "Einstellungen" (eman-deutsch already says الإعدادات).
- The settings view renders four groups, each a glass panel (`.grp`) with a group heading (`h2.gh`) and the former
  sections as `h3`:
  - Funktionen (`grpFn`): sync (GitHub token), daily reminder, Gemini key.
  - Lernen (`grpLearn`): new words per day, new phrases per day, meaning first for known cards, Arabic first,
    natural voice, slower speech.
  - Aussehen (`grpStyle`): the dock orientation (5.).
  - Daten (`grpData`): backup (export, import), reset.
- New `t` keys in both apps: `grpFn`, `grpLearn`, `grpStyle`, `grpData`, `dockVert`. `optsH`, `segW`, `segP` are
  no longer read (left in the apps for now).

## 5. Vertical dock (Aussehen)

- Option `dockV` (progress `opts`, synced like the other options; checkbox `#dkv`). The dock reads it on every
  `refresh` and toggles `body.dock-v`.
- Vertical: the knob rests in the same bottom right corner; a tap drives it up to the middle of the right edge
  (animated `bottom`, not `vh`: in Safari with its toolbar 100vh and the window differ, 50 % does not), the pill grows
  up and down out of it (88 px wide, lens 80 px, up to 380 px high, centred on the knob), the views are stacked, a
  vertical swipe turns them, ArrowUp/ArrowDown work on the keyboard, the centred icon is lifted 9 px with its label
  below, as in the horizontal pill.
- Labels always fit inside the lens: the dock measures each label (again once the fonts are loaded) and sets a smaller
  font size for a name that would exceed the lens minus 8 px at the centred button's 1.25× ("Einstellungen"). On closing the pill falls into the knob and the knob drives back
  down to the corner. No RTL mirroring on the vertical axis.
- Horizontal stays exactly as it is.

## Tests

- E2E (Eman, RTL): the words tab has no switch and no phrase rows; the phrases tab shows the phrase in its group with
  the starter button (the former switch checks); the settings show the four Arabic group headings; with the vertical
  option on, the knob drives to the middle of the right edge, the pill is taller than wide and centred on it, a
  vertical swipe settles on the next view, and after Escape the knob is back in the corner; the label's opacity is 0
  right after the pill starts closing.
- Not verifiable here: the wipe on Safari (clip-path animation), the vertical pill with the glass blur on the phone.

## Delivery

- App PRs first (both apps: nav button, texts; de-karteikarten also the tab label), then the engine PR (its CI runs
  against the apps' `main`). Both merged when green; the engine within minutes of the apps.
