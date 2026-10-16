---
name: undo-one-step-per-mutation
description: How undo steps are decided (savedDataChanged, pushed after the write), live-tab reopen/close effects for Now Open drops, and the stale-render rev trap in useUndoRedo
metadata:
  type: reference
---

**One rule decides every undo step:** `savedDataChanged(before, after)` in `src/lib/undoHistory.ts`
(saved groups only; ignores Now Open, `updatedAt`/`pendingSync`/`positionDirty`/`remoteUpdatedAt`/`info`).
`useGroupsMutation` (useGroups.ts), `updateWithUndo` (useBulkActions.ts) and `commitResolved`
(useDndHandlers.ts) all gate on it. All of them now record the step inside the write (`recordStep` in `afterWrite`, see
[[learnings-undo-history-in-write]]); DnD no longer pushes at the commit nor pops on rollback. `skipUndo` is only left on info recounts
and reminders (their chrome alarms stay scheduled, an undo can't take them back).

**Before this, two failure modes looked like "the drop made no undo step":**
- `dndMove` marked every drop touching Now Open `undoable:false` (drag out, drag in, Now Open row/zone).
- No-op and Now Open-only writes (Now Open tab delete, bulk delete of live tabs, rename to the same name)
  DID push a step whose restore changes nothing (restoreSnapshotAsLocalChange keeps the live Now Open),
  so the next Undo appeared to do nothing / undo something older.
A saved-to-saved cross-group drop into the new-window zone was already one step (unit + real popup e2e).

**Live tabs:** `src/lib/undoLiveTabs.ts` keeps a WeakMap from history entry object to a
`{kind:'reopen'|'close', tabs: LiveTabRecord[]}` effect. Running it returns the inverse, which
useUndoRedo tags onto the entry the pop pushed onto the other stack. Drag-out tags `reopen` (records from
the commit base's Now Open); drops/menus/bulk moves into Now Open tag `close` with the ids Chrome returned
(`runSideEffects` now returns the opened tabs). Close is by id only; a tab that is gone or whose url and
pendingUrl both differ from the record (navigated) is skipped. A tab whose close is still deferred to popup
teardown is kept via `keepTabsOpen` (port message `keepTabIds`, handled in background.ts) instead of reopened.
Tab-closing helpers moved to `src/lib/closeLiveTabs.ts` (`partitionClosableTabs` re-exported from useDndHandlers).

**Stale-render trap:** useUndoRedo used the render's `useGroups().data` as the base and wrote with
`expectedRev: base.rev`. Undo then Redo before the re-render (or right after any other write) was refused
with "Your groups changed elsewhere". (SUPERSEDED: the Undo now restores inside its own write step on a fresh read, with a cursor check instead of expectedRev; see [[learnings-undo-history-in-write]].)
Test files that `vi.mock('@/hooks/useGroups')` and render the Header need `useGroupsSnapshot` in the mock.

**What wipes history while the popup is open (checked against sync):**
- `onForeignGroupsChange` (pull/realtime APPLYING remote changes) is NOT fired by this device's own
  push, its realtime echo (pending during flight, equal stamp after `markPushed`), the pulls after it, or
  a position-only push (the returned stamp becomes the base). `markPushed` never broadcasts. Proof:
  `src/__tests__/integration/undoSurvivesOwnSync.integration.test.ts`.
- Groups broadcasts from another context: the worker writes groups only for context-menu/shortcut saves,
  URL-rule saves (tabs.onCreated / onUpdated 'complete') and SYNC_NOW. A URL rule saving a tab the popup
  itself opened was the one self-inflicted wipe: the broadcast now carries `cause: {kind:'url-rule', tabId}`
  (`updateGroupsState` opts.cause in localDb.ts, `cause.url` = the saved tab's url) and the popup keeps
  history only via `consumeOwnOpenedTab(tabId, url)` (`src/lib/ownOpenedTabs.ts`): ONE-SHOT, within
  `OWN_TAB_WINDOW_MS` (10 s) of opening, and only at the URL it opened (normalised with `new URL().href`).
  A longer-lived exemption is harmful: the rule engine also fires on every load 'complete', so a stale one
  kept history whose Undo silently deleted a later, unrelated capture.

**Late remote-delete markers vs Undo:** `deleteRemoteGroups` awaits `auth.getSession()` (maybe a network
refresh) before marking. An Undo landing first got its restored ids re-marked pending, then DELETEd on
the server and pruned by the next merge. Now `addPendingGroupDeletesIfAbsent` (localDb.ts) runs as a
queued groups-write step over groups + settings, records only ids still absent, and only those are
DELETEd. Undo/redo itself calls `deleteRemoteGroups` for the saved groups a restore removes (same as the
forward action; the write's `cloudSyncActive` gate is off until entitlements load). Tests can hold the
fake session with `fakeRemote.hold('getSession')`. Proof:
`src/__tests__/integration/undoRemoteDelete.integration.test.ts` (fails on the old code).
`useGroupsMutation`'s transform may return `null` = no write (no rev bump, no broadcast).

**Test harness gotchas:**
- Seed saved tabs with `savedAt`, or the groups query's first read runs the savedAt migration WRITE (a
  foreign write that bumps rev mid-test and makes the next undo refuse).
- An in-memory `getGroupsState` mock has no write-generation re-read: wait for `qc.isFetching() === 0`
  after render, or the mount read resolves after the drop and puts the old state back in the cache.
- Raw CDP e2e test titles with an apostrophe: use double quotes (sed/python escaping of `\'` is fragile).

Related: [[dnd-unified-layer]], [[learnings_now_open_close_own_window_rule]], [[learnings_groups_rmw_lock]]
