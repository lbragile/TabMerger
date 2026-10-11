---
name: dnd-finishing-pass-roving-clickaway-nowopen-move
description: Window-header roving toolbar, the click-away self-exit bug, e2e IS runnable, Now Open drag-out becomes a MOVE with a deferred anchor-tab close, emptied windows kept, new-group zone hides at the cap
metadata:
  type: project
---

# DnD finishing pass (2026-09-17/18)

## The extension E2E suite DOES run here — and it caught a real bug

The old `e2e-not-runnable-locally` note was wrong: the "blank popup" was the PRODUCTION
build being loaded (placeholder `.env.production` → `new URL()` throws in supabase-js).
`e2e/fixtures.ts` already prefers `.output/chrome-mv3-dev`, so the whole recipe is
"`build:dev` first, then run". Every spec passes.

**It must be re-built before every run** — the specs load the BUILT extension, so an
un-rebuilt `.output` silently tests the previous commit. That masked a fix for a whole run.

Two selector traps it exposed, both from real product changes:
- group ROW and its grip are both `role="button"` and the grip label now embeds the group
  name, so `getByRole('button', { name })` (a SUBSTRING match) is ambiguous → `exact: true`.
- selection mode now puts `role="checkbox"` on sidebar group rows and window headers too,
  so `getByRole('checkbox', { name: /^select /i })` no longer means "a tab". Scope it:
  `page.getByRole('listitem').getByRole('checkbox', …)`.
- The same ambiguity broke `e2e/repro/{dndMatrix,popupInstrumented}.repro.ts`, and
  `e2e/repro/harness.ts` additionally seeded IDB with NO settle delay, racing the popup's
  own empty-DB init — every seeded group was silently lost. `popupRealDnd`'s launcher had
  always waited 1500ms; the shared harness had not.

## `useSelectionClickAway` exited on the click that ENTERED selection mode

Clicking the header's "Select items" turned selection mode on and straight back off. For a
DISCRETE event React flushes passive effects synchronously **inside its own root-container
listener**, and a `document` listener added mid-dispatch still receives that same event
(the DOM spec only skips nodes already visited). The hook now ARMS on the next macrotask.

Rejected alternative: comparing `Event.timeStamp` to `performance.now()` at attach time.
It works in Chrome but **jsdom's `Event.timeStamp` is epoch-based**, not time-origin based,
so the guard is silently inert in tests — verified by printing both.

## Roving tabindex for the window header: use `role="toolbar"`

`toolbar` is the ARIA pattern for "one Tab stop, arrows between controls", so it both fits
and *announces the affordance* — which is why no `aria-describedby` hint was added to
tab/group rows (it would repeat on every one of ~50 rows on every Tab press).
`dndFocus`'s grip-less-window fallback became `[data-window-header]` (the header is now
focusable) with the old `[data-window-header] button` kept behind it.

A keyboard WINDOW drag needs **two** ArrowDowns to move one slot (the first is absorbed);
a tab drag needs two to move two. Read `[id^="DndLiveRegion"]` to see what dnd-kit thinks.

## Now Open drag-out is a MOVE — the anchor tab CAN be closed, just not synchronously

C7 stands: closing the active tab of the popup's anchor window dismisses the popup. The
split that works:
- `applyMove` stays pure and emits `{ type: 'tabs.remove', tabIds }`;
- `runSideEffects` partitions with `chrome.tabs.query({ active: true })` — originally
  **every** active tab was deferred and the rest closed immediately. Superseded 2026-10-09:
  only the active tab of the popup's own window is deferred, see
  `learnings_now_open_close_own_window_rule.md`;
- deferred ids go to the background over a long-lived port (`chrome.runtime.connect`), and
  the worker closes them on `onDisconnect`. That fires for EVERY way a popup can vanish,
  and an open port keeps the MV3 worker alive so the close can't be lost to eviction.
Proven in the real popup: the anchor tab survives the drop and is gone after the popup
closes; a whole Now Open window closes all its non-active tabs at once.

## Harness limits found while writing the click-away cases

The headless action popup's viewport is **670×510**, not 800×600. Anything in the bottom
~90px (the `SelectionActionBar`) or past x≈670 (the panel toolbar's "More group options")
is off-screen, and `elementFromPoint` there returns **null** — a click at those coordinates
hits nothing and reads as a *background* click, which silently inverts the test's meaning.
Always assert `elementFromPoint` lands on the intended element before clicking. Reachable
substitute for a modal dropdown: right-click the window header (`contextmenu`).

Also: `[data-radix-popper-content-wrapper]` is shared with TOOLTIPS, so counting it to
detect "the colour picker is open" is wrong when a hover left a tooltip up — count the
swatch buttons (`button[title^="rgba("]`) instead.

## Two design reversals landed at the end

- **Emptied windows are KEPT** (`dndMove` + `useGroups`, which previously disagreed).
  Focus after a keyboard drop cannot follow the emptied window: `locate` matches by
  STRUCTURAL identity and a window that lost its last tab no longer matches its `before`
  self — and positional fallback is forbidden. It goes to the sibling window instead.
- **The new-group zone HIDES at the free cap** rather than showing and warning. The
  `setNewGroupZoneGate` module gate lost its `onBlocked` callback and the `onDragEnd` check
  now refuses silently (it only ever fires for a target resolved from the throttled stream).

## `DEFAULT_GROUP_TITLE` is 'temp group' in the extension

`src/lib/utils.ts#createGroup` imports it from **`@/lib/types`** (`'temp group'`), not from
`@tabmerger/shared` (`'New'`). The extension's local `types.ts` duplicates and overrides the
shared constants — always check which module a constant came from before quoting its value.
