---
name: learnings-now-open-dnd-copy-semantics
description: Dragging OUT of Now Open used to emit tabs.remove, which closed the popup's own anchor tab and made Chrome dismiss the toolbar popup mid-drop; DnD out of Now Open is now a COPY with zero side effects
metadata:
  type: project
---

# DnD out of "Now Open" is a COPY, never a close

**Fact:** `dndMove.ts` used to emit `tabs.remove` when a live Now Open tab (single) or
whole window was dropped on a saved group. Closing the ACTIVE tab of the window the
MV3 toolbar popup is anchored to makes Chrome dismiss the popup instantly, which looked
to users like "dragging a tab across groups crashes the popup". A window drag also
closed the user's real browser window. `tabs.remove` is now gone from the
`DndSideEffect` union and from `runSideEffects` in `useDndHandlers.ts`.

**Why:** every other Now Open path already copied: Tab.tsx's context menu uses
`copy: isNowOpen` ("Copy to group"), and URL rules never call `chrome.tabs.remove`.
DnD was the only exception. The reverse direction (INTO Now Open) opens real browser
tabs/windows via `chrome.tabs.create`/`chrome.windows.create`, never an IndexedDB insert.

**How to apply:**
- Never reintroduce a destructive chrome call in any popup DnD path. The regression
  guard is an exhaustive sweep in `src/__tests__/unit/lib/dndMove.test.ts`.
- Every earlier real-popup repro dragged FROM saved groups, so this class of bug was
  invisible. `popupRealDnd.repro.ts` now has a `launch({ hostUrl, extraTabUrls })`
  option using `data:text/html,<title>X</title>` tabs, so Now Open has named live tabs.
  It counts real tabs via the service worker's `chrome.tabs.query` (the popup is not
  in that list, and it may already be dead).
- Harness gotchas hit while writing those tests:
  - The Window drag grip only renders when `siblingCount > 1`. Now Open needs a 2nd real
    window (`launch({ extraWindowUrls })` calls `chrome.windows.create({focused:false})`
    from the service worker).
  - `Tab.tsx` rows ALSO carry `data-window-index`, so `row.closest('[data-window-index]')`
    returns the tab row itself. Walk up to the ancestor that holds a window grip.
  - `RawCdp.send` has NO timeout, so evaluating against a dismissed popup hangs until the
    test's 120s timeout. Race the liveness probe against a timer and guard the loser's log.
  - `RawCdp.attach` could throw "Unexpected end of JSON input" when `/json` returned an
    empty body right after launch. It now retries until the deadline.
  - The pre-existing "REGRESSION HUNT: fast cross-group TAB drop" test is a timing flake
    (about 1 in 3 fails): the 15ms flick releases before any `dragover`, so `rawOverId` is
    the source and nothing commits. The popup stays alive, and it is not a regression.
- The brief claimed `moveTabsMulti` also emitted `tabs.remove`, but it never did
  (the pinned test was really the single-window case). It has a separate latent bug:
  it splices the tabs out of Now Open in `next` and does not detach them, so live ids
  leak into saved groups. Fixed 2026-09-13 (sweep test in `dndMoveMultiRules`).
