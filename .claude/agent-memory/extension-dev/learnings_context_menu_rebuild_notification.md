## Context menu rebuild notification (buildMenus never re-ran on group changes)

Bug: `buildMenus()`/`_buildMenus()` in `packages/extension/src/entrypoints/background.ts`
was only called on `onInstalled`/`onStartup`/module init — nothing rebuilt the "Save to
TabMerger" right-click menu when groups changed (created in popup, renamed, deleted, synced
down). Fixed at the `localDb.ts` write layer so every writer (16+ call sites) is covered
without per-caller changes.

### The two-listener-path problem
Writers run in BOTH the popup/extension pages AND inside the background SW itself
(syncEngine, urlRuleEngine, command handlers). `chrome.runtime.sendMessage` **never
delivers to the sender's own `onMessage` listeners** — a write issued from inside the SW
calling `sendMessage` silently no-ops, no error. Fix: `localDb.ts` exposes
`registerGroupsChangeListener(cb)`; `background.ts` calls it once at startup with a direct
callback. The internal `notifyGroupsChanged()` checks "is a direct listener registered?"
first, and only falls back to `sendMessage` when not (i.e. called from the popup). No
import cycle: the lib module never imports the background entrypoint, only exposes a
registration function that inverts the dependency.

`sendMessage` from the popup *does* wake a sleeping/evicted SW as a side effect of message
delivery — no special code needed for that half. "Receiving end does not exist" surfaces via
`chrome.runtime.lastError` inside the sendMessage callback (when using the callback form,
not a Promise) — read `lastError` there to mark it handled; it does not reject a Promise.

### Debounce + mid-build re-run for `chrome.contextMenus` rebuilds
Bulk actions / DnD reorders / sync fire bursts of writes. Two-part fix, both needed:
1. Debounce trigger calls behind a `setTimeout` (~150ms), armed once per burst
   (`if (timer) return`) — coalesces N notifications into one scheduled rebuild.
2. The pre-existing `_building` re-entry guard just `return`ed, **dropping** any request
   that arrived mid-build — if that request's state change happened after the in-flight
   build's `getGroupsState()` already ran, the menu goes stale with no self-correction.
   Replaced with a `_rebuildPending` flag: one more rebuild runs immediately after the
   in-flight one finishes, re-reading groups fresh.

### Files
`packages/extension/src/lib/localDb.ts` (notify + registration), `packages/extension/src/entrypoints/background.ts` (scheduleMenuRebuild + buildMenus rewrite), tests in `src/__tests__/unit/lib/localDb.test.ts` and `src/__tests__/unit/entrypoints/background.test.ts`.

Excluded deliberately: `markGroupSynced`/`markAllGroupsPendingSync` only flip the
`pendingSync` flag and must NOT trigger a rebuild (verified with a dedicated test).
