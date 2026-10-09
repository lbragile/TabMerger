---
name: learnings-now-open-close-own-window-rule
description: A Now Open drag-out defers only the active tab of the window TabMerger itself is in (chrome.windows.getCurrent); every other tab, active or not, closes at the drop; unknown window falls back to deferring every active tab
metadata:
  type: reference
---

# Now Open drag-out: only the own window's active tab waits

Decision: `partitionClosableTabs` (in `hooks/useDndHandlers.ts`) defers a tab only when it is
active AND in the window the TabMerger page lives in. Everything else in a `tabs.remove`
closes at the drop, so a dragged window that TabMerger is not attached to closes completely.

## Why that is enough (read from the Chromium source, `extension_popup.cc`)

- The action popup adds itself as an observer of ITS OWN browser's tab strip only
  (`browser_->GetTabStripModel()->AddObserver(this)`) and closes when
  `selection.active_tab_changed()`. Another window's tab strip is never observed.
- The other close trigger is widget activation inside the anchor window's widget tree.
  Closing a window that is not the active one does not move activation.

## How the page knows its window

- `chrome.windows.getCurrent()`: "the window that contains the code that is currently
  executing", which can differ from the focused window (Chrome docs). MDN says the same for
  Firefox: a document associated with a browser window gets that window. For a toolbar popup
  that is the window it hangs off; for `popup.html` opened as an ordinary tab (e2e, the demo
  recorder) it is the window holding that tab.
- `chrome.tabs.getCurrent()` is NOT usable: it resolves `undefined` in a popup view.
- Only in a service worker does "current" fall back to the last active window, so this must
  stay in the page, never move to the background.

## Measured in headless Chrome (`--headless=new`, dev build, raw CDP drag)

- Real toolbar popup: `windows.getCurrent()` returned the host tab's window; `tabs.getCurrent()`
  was `undefined`. Dragging a 3-tab window the popup was not attached to closed the whole
  window about 250 ms after mouse release with the popup still alive; dragging the popup's
  own window closed its non-active tabs, kept the active one, and that one closed when the
  popup closed.
- `popup.html` as a tab: `windows.getCurrent()` equals `tabs.getCurrent().windowId`. A window
  elsewhere closes whole at the drop. Dragging the window that holds the TabMerger tab closes
  all its Now Open tabs (the TabMerger tab is the active one and is never in Now Open) and
  the window survives with just the TabMerger tab.
- Headless cannot show OS focus effects (spec C12), so "closing another window never
  dismisses the popup" is measured for the tab-strip trigger and read-only for activation.

## Decision: `tabs.remove` stays, no `windows.remove`

Closing every tab of a window closes the window, so the effect is the same for the tabs
Now Open knew about. `windows.remove` would also close tabs the drop never saved: one
opened after the last Now Open sync, or the extension's own pages, which `syncNowOpen`
filters out (TabMerger open as a tab in the dragged window would close itself). It would
also need a second code path for whole windows next to the tab paths.

Platform fact (measured from the service worker): `chrome.tabs.remove([a, stale, b, c])`
rejects with "No tab with id" and closes only the ids BEFORE the stale one. The background
worker's disconnect handler already retries per id for that reason.

## Running a one-off probe outside the repo

A `tsx` script in a temp folder can drive the built extension: `createRequire` anchored at
`packages/extension/e2e/` resolves `@playwright/test`, and `e2e/helpers.ts` / `e2e/rawCdp.ts`
load through `import(pathToFileURL(...))`. tsx (esbuild `keepNames`) wraps inner functions of
any callback passed to `page.evaluate` in `__name(...)`, which does not exist in the page:
define `globalThis.__name = (f) => f` in the page and in the service worker first.

## Fallback (pinned in `unit/hooks/dndNowOpenMoveOut.test.ts`)

Defer EVERY active tab when the own window is unknown: `getCurrent` missing or rejecting, a
window with no id or `WINDOW_ID_NONE` (-1), or an id that owns none of the active tabs
`tabs.query({active:true})` returned. A test stub without `windows.getCurrent` therefore
exercises the fallback, not the main rule; a stub must opt in to an own window.
