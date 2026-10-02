---
name: learnings-phase1-cross-group-active-group
description: Phase-1 DnD (2026-09-12) — useGroups staleTime:0 refetch-on-mount clobbered the optimistic DnD commit (fixed with read-your-writes in localDb); dnd-kit re-measures ALL droppables when the container set changes even under BeforeDragging; the headless CDP harness cannot prove focused:false; group-row drop = new window; picked-up group becomes active
metadata:
  type: project
---

# Phase 1: cross-group moves + dragged group becomes active (2026-09-12)

Follows [[learnings-dnd-collapse-instant-drop-probe]] and [[learnings-now-open-dnd-copy-semantics]].

## The real bug found: optimistic cache write clobbered by a refetch-on-mount
`useGroups` overrides the client default with `staleTime: 0`, and many components call
`useGroups()` (GroupItem, Window, …). Every observer MOUNT therefore refetches from IDB.
The DnD drop writes the cache synchronously (single-paint) and THEN `await saveGroupsState`,
whose readwrite tx is only created after internal awaits (`getDb`, `getAllKeys`). A mount
caused by the commit itself (new window in a VISIBLE destination after spring-open, or the
panel re-rendering after an `activeGroupIndex` change) started a refetch in that gap, read
the PRE-drop state, and overwrote the cache ~150ms later. Frames: correct for 3 frames, then
reverted permanently while IDB held the new state (a later mutation from that stale cache
could write the old state back).
- Invisible in every test that drops onto a group row whose panel isn't shown (no mount).
- Diagnosed with the sampler's `[query-writes]` trace (`fetch`/`success` actions relative to drop).
- Fix: `localDb.saveGroupsState` serializes writes on a promise tail; `getGroupsState` awaits
  the tail first (read-your-writes). Plus `qc.cancelQueries(GROUPS)` right before the DnD
  commit for a fetch already in flight across the drop. Regression test in
  `unit/lib/localDb.test.ts` (fails without the await).
- **How to apply:** any new "set cache, then await IDB write" path is safe only because of the
  write tail. Never add a groups reader that bypasses `getGroupsState`. Flag localDb changes
  for `sync-conflict-auditor`.

## dnd-kit: BeforeDragging does NOT freeze droppableRects when containers change
`useDroppableMeasuring` (core 6.3.1): `disabled = dragging` for BeforeDragging, but the
`useLazyMemo` recomputes (live-measures EVERY container) whenever `containersRef.current !==
containers` — i.e. any droppable mount/unmount mid-drag (panel swap). Our collision stays
stable only because `virtualDroppableRects` iterates the drag-start `geometry.base` snapshot
for ids still mounted. Group drags survive a panel swap because they only collide with
sidebar group rows (verified in the real popup by geometry).

## Headless harness cannot prove `focused:false`
Real-popup diagnostic: `chrome.windows.create({focused:true})` from the popup did NOT dismiss
it under `--headless=new`. The Now Open row tests prove "popup survives + one new window", not
that `focused:false` is load-bearing. `focused:false` is pinned by unit tests only; a human
must confirm in headed Chrome.

## Behaviour decisions made (report to coordinator)
- Group ROW drop (tab or window, including the item's own group) = NEW window at the end.
  Foreign WINDOW list after spring-open now commits positionally (dndInsertion returns the
  window after the gap, or the group id to append) — previously the gap and commit disagreed.
- A move that empties a saved source window removes it (even the group's only window → 0
  windows). This diverges from useGroups' rule of keeping the last window. (Reversed later:
  emptied windows are KEPT, see `learnings_dnd_finishing_pass.md`.)
- A LIVE Now Open tab/window on the Now Open row is rejected in `canDrop`.
- Pickup activation must run in rAF (`afterDispatch`) and be guarded by `activeRef.current?.id`;
  the post-reorder `setActiveGroupIndex` must be inside the same flushSync as `setGroupsNow`
  (a separate commit paints the group now at the old index for a frame).

## Harness gotchas
- `-g "…\\(…"` in a bash double-quoted string reaches Playwright as `\\(` → "Unterminated
  group", zero tests run, exit code masked by the pipe. Avoid regex escapes in `-g`.
- `grep -v … > file` block-buffers: no interim output while a long run is going.
- Playwright's `test-failed-*.png` in repro runs is its own blank page, not the popup — use
  the screencast frames.
