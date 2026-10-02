# Lens dock: the tab bar as a hidden pill behind one glass knob

Date: 2026-10-01. Replaces the five-button tab bar in both apps. Decided on a throwaway demo (variant D).

## Goal

Free the screen of the permanent bar. One round glass "knob" in the bottom middle shows the current view (its icon)
and the number of cards waiting. A tap raises a glass pill with the five views; a swipe turns them without end,
a tap picks one; the pick becomes the view, the pill sinks and the knob shrinks back with the new icon. Same look
and motion in both apps, right-to-left for eman-deutsch.

## What stays, what changes

- The apps keep their `<nav>` with five `<button data-mode>` (icon SVG, label, `#badge` in the learn button).
  No app markup change, no new `t` keys: the knob copies the current button's icon and label. An old `index.html`
  works with the new engine.
- The old bar is removed, not kept behind a flag (decision of 2026-10-01).
- de-karteikarten: the label "der/die/das" becomes "Artikel" (separate one-line PR in the app repo).
  eman-deutsch keeps "der/die/das" until a word is chosen.

## Behaviour

Closed (default): only the knob, 58 px, bottom middle, above the safe area. It shows the current view's icon in the
accent colour and the due count as a badge (`#badge` is mirrored there). Its `aria-label` is the current view's label,
`aria-expanded="false"`.

Open (tap on the knob): the pill rises from below (translateY 110 px → 0, opacity 0 → 1, 0.4 s, the knob grows
to 1.45× and fades out); the lens (`nav::before`, 80 × 64 px, glass-strong with an accent glow) sits in the pill's
centre. The five buttons are laid out on a 72 px grid around the centre, their offsets transformed every frame;
the centred one is scaled 1.25 and raised 3 px, the others shrink with distance (down to 0.8) and fade beyond
2.6 slots. Only the centred button shows its label. The badge of the learn button sits on the icon's shoulder so the
pill's clipping cannot cut it.

Picking:
- Swipe: `pointerdown` captures the pointer; `pointermove` moves the row by `dx / 72` slots (mirrored in RTL); the
  row has no ends (each button is drawn at its nearest turn of the loop of five). On lift, the row glides frame by
  frame (`requestAnimationFrame`, cubic ease-out, 200 ms + 120 ms per slot, max 520 ms) to the nearest slot after a
  flick projection of 160 ms of the last velocity. `pointercancel` and `lostpointercapture` settle the same way:
  the row is never left between icons. `touch-action: none` on the nav keeps the browser from taking the gesture.
- Tap: a lift without 6 px of movement picks the button under the finger (`elementFromPoint`, because pointer
  capture retargets events to the nav), glides it to the centre. A `click` on a button that arrives without a
  preceding pointer release (120 ms) picks the same way (fallback for keyboard users and for a touch sequence the
  browser ends differently).
- After the pick settles the view switches (`router.go(mode)`: set mode, `enter()`, render, scroll to top), the
  pill sinks after 240 ms (tap) or 520 ms (swipe) and the knob returns with the new icon.
- Idle: 3.5 s after opening, or after the last touch on the pill, it sinks by itself without a change.
- A second tap on the knob while open is impossible (the knob is faded out and inert); tapping outside the pill does
  nothing.

Accessibility: buttons stay real buttons (`aria-current="page"` on the chosen one, as today); the knob has
`aria-label` and `aria-expanded`; the hidden pill carries `aria-hidden="true"`. `prefers-reduced-motion` removes the
pill, knob and label transitions; the per-frame glide still runs (it is the row's position, not decoration), but
with the same end state after at most 520 ms.

Hold: the knob and the pill are outside `#main`, so they stay usable while slow work holds the main area (rule 5.1),
as the bar does today.

## Structure in the engine

- `src/core/dock.js` (pure, unit-tested): `nearestTurn(d, n)` (offset of an item drawn at its nearest turn of a loop
  of `n`), `settleTarget(pos, velocity, slotsPerPx)` (where a lift lands, with the 160 ms flick projection),
  `glideDuration(distance)`.
- `src/ui/dock.js`: `createDock(ctx, nav)` → `{ refresh }`. Builds the knob after the nav, owns the drag, the glide,
  the open/closed state and the idle timer (closure state, nothing module-level), resolves taps and the click
  fallback, calls `ctx.go(mode)`. `refresh(dueN)` is called by the router after every render: knob icon (clone of
  the current button's SVG), label, badge text, `aria-current` on the buttons.
- `src/ui/router.js`: new `go(mode)` with the logic of today's nav click handler; the click handler calls it. The
  router no longer touches `aria-current` or `#badge` directly; `ctx.dock.refresh(dueN)` does.
- `src/main.js`: `ctx.go = mode => router.go(mode)`; `ctx.dock = createDock(ctx, document.querySelector("nav"))`.
- `app.css`: nav as the pill (fixed, bottom above the safe area, 72 px, glass, overflow hidden, closed state),
  `nav::before` lens, `nav button` absolute and transformed, label rule, `.knob`, edge fades, reduced motion.
  Colours stay app tokens (`--glass`, `--glass-strong`, `--rim`, `--shine`, `--shadow`, `--accent`, `--again`).
- Bundle: about +2.5 KB minified; stays under 60 KB.

## Tests

- Unit (`tests/unit/core.test.js`): `nearestTurn` over a loop of five (0..4, -1, -3, 7, 2.6 → -2.4), `settleTarget`
  for a lift without speed, a flick forward and backward, and the mirrored direction; `glideDuration` bounds.
- E2E (`tests/e2e.cjs`):
  - `tab(page, mode)` taps the knob, clicks the button and waits until the pill is closed, so every existing check
    keeps its meaning.
  - New checks (Eman, RTL): the knob shows the current view's icon and Arabic label with the due count; a touch swipe
    on the open pill settles on the next view, switches to it and the pill closes; an untouched pill closes by itself.
- The de-karteikarten fingerprint has no part in this (no Gemini request); the `DUMP_RUN` is diffed anyway.
- Not verifiable here: the feel on a real iPhone (momentum, the knob's distance from the home indicator), Safari's
  backdrop blur on the moving pill. Named in the PR with what to try on the phone.

## Tuned after use on the phone (2026-10-02)

- Pill 80 px high, 94 % wide (max 380 px), slots 76 px, lens 88 × 72 px, icons 26 px.
- The label sits outside the flow, so the icons of the other views are in the pill's vertical middle; the centred icon
  rises 9 px and its label fades in with the distance to the centre (nothing jumps mid-glide).
- After a pick (tap or swipe) the pill stays up for the idle time (3.5 s) before it sinks, like an untouched pill.
- Rise and sink take 0.7 s with a softer ease (knob 0.7 s too).
- The knob shows the due count only while it shows the view whose button holds `#badge` (learn); on the other views
  the knob is plain.
- The pill no longer rises from below: closed it has the knob's size and place; it grows out of the knob to both sides
  (width, height and bottom, 0.7 s, the same ease), the buttons appearing from behind its edge, and on closing it falls
  back into the knob and only then fades (opacity delayed 0.45 s). Then the knob drives back to its corner.
- The handover is seamless (a flicker was seen on the phone with the knob fading and growing over the appearing pill):
  the pill appears at once and the knob vanishes in the same frame (no scale, no fade on the way out); the centred
  button starts with the knob's look (scale 1, icon not raised, no label) and grows into the pill's look with the pill
  (`nav.rising`, 0.7 s, removed on the first touch so the swipe is not laggy); the knob's badge sits where the pill's
  badge sits. On closing the knob fades in under the collapsing pill as before.
- The knob lives in the bottom right corner in both apps (in RTL too: the thumb is the same), 18 px from the edge. A tap drives it to the middle (0.6 s, `transform`, the same ease as the pill), and only then does the pill
  rise as before. After the pill has sunk (0.7 s) the knob drives back to its corner (0.6 s). A second tap while it is on
  its way is ignored; a tap during the way back turns it round. Under reduced motion it jumps.

## Delivery

- Engine branch `lens-dock`, one PR; commits: pure core + tests, dock module + CSS + router, e2e updates, docs
  (README "What is here", PLAN status note).
- de-karteikarten: branch with the "Artikel" label; both merged when the user says so. The engine PR is safe to merge
  on its own (no app dependency).
