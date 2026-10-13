---
name: learnings-guided-tour
description: Guided tour of the popup (lib/tour.ts, lib/tourSteps.ts, components/Tour) - storage record lifecycle, how it locks the app underneath, the focus and key-handling traps, and why every e2e launcher must dismiss it
metadata:
  type: learning
---

**Where things live.** `src/lib/tour.ts` (stored record + pure geometry), `src/lib/tourSteps.ts` (copy and
anchor names, data only), `src/lib/tourDom.ts` (DOM reads), `src/components/Tour/` (overlay + card),
`src/hooks/useTourAutoStart.ts`, `useTourAnchorRect.ts`, `useTourKeys.ts`. Anchors are `data-tour="…"`
attributes on the real controls; a step whose anchor is not on the page is dropped.

**Stored record.** `chrome.storage.local` key `tm_tour`: absent (never auto-start), `{status:'pending'}`
(written by `onInstalled` when `reason === 'install'` only), `{status:'pending', stepId}` (in progress,
resume there), `{status:'done'}`. Deliberately not an IndexedDB setting: "Clear all data" wipes those, and
the service worker writes the flag without the popup. Decision: a replayed tour is also stored as pending,
so it resumes after the popup closes like the first run does.

**A fresh browser profile is a first install.** Every Playwright launch (`launchPersistentContext('')`)
fires `onInstalled` with `install`, so the tour would cover the popup in every spec. `dismissTour(context)`
in `e2e/helpers.ts` writes `done`; the `context` fixture calls it unless a spec sets
`test.use({ tour: 'pending' })`. Code that launches its own context (kbdPopup, popup-dnd specs, repro
harnesses, seedDev) must call it itself, before the first popup page opens. It waits for the install
handler's own write first: that handler reads then writes, so writing `done` earlier could be overwritten.

**Locking the app under an overlay.** The overlay is a portal on `<body>`; every child of `#root` gets
the `inert` attribute while it shows (`lockTourApp`), EXCEPT sonner's toast region (and, on an interactive
step, the controls that step unlocks: see below). Sonner renders its
`<section aria-live>` in place, inside `#root` (not in a portal), so `inert` on the root itself would
silence toast announcements and put toast buttons out of reach. `inert` blocks clicks, drags and focus
and hides the app from assistive technology, and `getBoundingClientRect` on inert elements still works.
Remove `inert` BEFORE returning focus to an element inside the root: an inert element cannot be focused.

**One announcement per step.** The card's polite status line carries the whole step (progress, title,
text) and is the only announcer. For that to hold: the dialog has a constant `aria-label` and no
`aria-describedby` (a name built from the title is read again whenever focus lands on the card), focus
is NOT moved on a step change unless it fell out of the card, and the status text is set in an effect
after mount (a live region inserted already filled in is often not announced). Same rule applied to
the Settings backups status line: keep the `role="status"` element mounted and change its text.

**Held keys.** Ignore `event.repeat` for step keys, and `preventDefault` a repeated Enter even on a
focused button: the browser's own key repeat clicks a focused button again and again.

**Prefer `aria-disabled` + a guarded handler over `disabled` for a busy button**: a button that
becomes `disabled` while focused drops focus to `<body>`.

**Silencing every app key handler.** One capture-phase `keydown` listener on `window` that calls
`stopImmediatePropagation()` runs before every other handler in the popup (they listen on `document` or
`window`, capture or bubble). Activating a focused button with Enter or Space is the browser's default
action, not a listener, so the overlay's own buttons keep working. React handlers on the overlay's
elements do NOT see key events after this, so all key logic has to live in that one listener.

**Focus trap gotcha.** An element with `visibility: hidden` cannot take focus. A card that renders
`invisible` until it has been measured, then is positioned from a layout effect, is still hidden when the
passive effect of that first commit runs (React flushes passive effects before the re-render the layout
effect asked for). Gate the focus effect on "has a position", not only on the step id.

**The card is `role="dialog"`.** `useSelectionClickAway` and the DnD/keyboard-move code treat any
`[role="dialog"]` in the document as an open overlay, so they stand down by themselves while the tour shows.

**Never `scrollIntoView` in the popup.** It can scroll the `overflow: hidden` body, which has no scrollbar
to scroll back with. Set `scrollTop` on the anchor's own scroll container instead (`revealTourAnchor`).

**Tests.** `App.test.tsx` and `appDndProvider.test.tsx` mock every child of `App` and a partial uiStore; a
new child that reads store state they do not carry needs its own `vi.mock` there.

**Interactive steps and the two rings.** `lib/tourTasks.ts` holds the "try it" steps as pure functions over
a snapshot of real state: `available`, `baseline`, `isDone`, and `targets` = `{ highlight, action, allow,
lockRoots }`. `highlight` is the region (dim + cut-out), `action` the ONE control to use next. Both are lists
of selector lists, furthest point of the task first; the first list with something visible wins, measured
every animation frame, so the ring moves by itself when a menu, popover or dialog mounts. Prefer a selector
that is only true at that point (`:not([disabled])` on "Save changes", an open `[role="listbox"]`) or real
state in the task context (the colour picker's preview colour); where neither exists the control carries
`data-tour-ready` (the group name's "Save" button). With an action ring up the region is `calm` (thin line, no
pulse) or `merged` (same control: dim only). The lock is an allow-list: everything in `#root` is inert except
`allow` and its ancestors, whose siblings are inert instead.

**Focus rules that were measured in a real build.**
- "Next" and "Skip this step" are the same DOM node (same element type in the same slot), so focus stays on
  it when a read-only step is followed by a task: a second Enter would skip the task. On entering a waiting
  task focus moves to the card itself; Enter does nothing there until the task is done.
- Tab order while a task waits is unlocked controls first, then the card's buttons (`allowedFirst`), so one
  Tab from the card reaches the control.
- A task that is done at the first keystroke (search) must not take focus from a text field: the rest of the
  word would be typed into the card.
- A popover that closes as the task completes returns focus to its trigger AFTER the "done" effect ran, so
  the hand-back to the card is repeated from the frame loop for 500 ms.
- A Radix tooltip lives in the same `[data-radix-popper-content-wrapper]` as menus and popovers and opens by
  itself on keyboard focus. Counting it as "a menu is open" blocks every focus hand-back for as long as focus
  stays on that control; `isForeignLayerOpen` skips wrappers holding a `[role="tooltip"]`.
- While a Radix modal dialog (Settings) is open it sets `aria-hidden` on everything outside it, except
  elements with `aria-live` and their ancestors. The card's status line is still announced, but its buttons
  are hidden from assistive technology and from Playwright's `getByRole` until the dialog closes: locate them
  with a CSS locator in a spec, and keep "close Settings" in the step's done text.

**Card placement.** `computeCardPosition` places beside the region; `cardPositionAvoiding` then moves the
card to the nearest frame corner when it would cover the action ring's control.

**Probing with tsx.** A script run with `tsx` that imports `e2e/helpers.ts` needs
`context.addInitScript('globalThis.__name = (f) => f')` (and the same once in the service worker): esbuild's
keep-names wraps inner functions in `__name(...)`, which does not exist inside `page.evaluate`.

**Editing gotcha.** Working copies here are CRLF. Git Bash `sed -i` rewrites the whole file with LF (git
shows no diff, but the file on disk changes). Use the Edit tool, or a Node script that detects the line
ending and converts its search and replacement strings.

Related: [[uistore-single-modal-slot]], [[selection-click-away-press-rule]], [[learnings-visual-regression-determinism]].
