---
name: filtered-index-and-set-aside-state
description: Audit rules for local-only rows in the synced list (tour practice groups) and for any undo history that is "put aside" and later restored
metadata:
  type: reference
---

Two audit rules from the guided-tour practice-data review (2026-10-13):

1. **One index space per position check.** When some rows of the local list are excluded from
   sync (`isTourDemoGroup`), the synced `position` is the index among the NON-excluded rows. Every
   place that produces OR compares a position must use that same filtered index: `pushPending`
   (producer), `writeGroupsState` (dirty derivation), `markPushed` (clears `positionDirty` by
   comparing against `stateRecord.order`), the `claimsSynced` check in `runSyncCycle`, and
   `orderByPosition` (which mixes remote positions with local raw indices). Grep all five whenever a
   new local-only row kind is added. Raw index >= filtered index, so a mismatch can only fail to clear
   a flag (stuck `positionDirty` = repeated position pushes + ignoring remote reorders), never clear
   one wrongly.

2. **A set-aside history must obey every invalidation.** `clearHistory()` is the safety valve for
   foreign changes, sign-out, account wipe and "Clear all data" (useSync, useExternalGroupsChanges,
   Settings). Any mechanism that stashes the live undo/redo stacks elsewhere (`uiStore.tourHistory`)
   and restores them later must be cleared by that same valve, or the restored snapshots predate the
   invalidation and an undo re-inserts deleted rows with no base (pushed as inserts).
   Same for "put the history back after a refused write" (`restoreHistory`): only valid if nothing
   touched the stacks during the await; compare stack identity first.

Related: [[groups-write-queue-constraints]], [[dnd-rebase-identity]].
