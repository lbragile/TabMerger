---
name: popup-unmount-and-write-scope
description: Popup close never runs React effect cleanups (so unmount flushes don't run there); reference preservation in a mutator scopes the sync stamp and the undo check, not the IDB put set
metadata:
  type: reference
---

**Popup close is not an unmount.** `entrypoints/popup/main.tsx` never calls `root.unmount()` on pagehide, and Chrome destroys the page when the popup closes, so `useEffect` cleanups (for example `useCurrentTabs`' flush of an armed timer) only run on in-app unmounts (StrictMode double-mount, re-keyed trees, tests). A delayed or throttled write that is still pending when the popup closes is simply lost. The next popup mount has to fix it (the Now Open mirror does that right away on mount). When an audit has to rely on a "flush on unmount", check where the hook actually unmounts in production.

**What keeping untouched group references buys.** `writeGroupsState` puts every group in `state.available` on every write, whatever the reference. Keeping untouched groups as the same object affects:
- whether a group gets `updatedAt`/`pendingSync` (that's the mutator's choice, and it decides which groups get pushed: stamping an unchanged group pushes this device's stale copy, and the compare-and-swap push turns that into a conflict copy);
- the cost of `savedDataChanged`, which skips same-reference groups and compares the rest with `JSON.stringify` (that check gates the undo step and the `savedUnchanged` flag on `GROUPS_CHANGED`).

A cloned group whose content didn't change is still correct: no step, no stamp. It just costs more to compare.

**Stamping Now Open is harmless but noisy.** Bulk ops that touch Now Open items stamp the permanent group `pendingSync: true`. It's filtered out at push (`syncEngine` `getPendingSyncGroups(...).filter(!permanent)`), at the merge, and by the next mirror pass (which sets `pendingSync: false`).

Related: [[learnings_groups_write_queue_constraints]], [[learnings_sync_server_stamp_and_merge_shape]]
