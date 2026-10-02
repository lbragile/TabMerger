---
name: dnd-zoned-ordering
description: Multi-group DnD mis-ordering root cause — two independent bugs (post-insert zone re-sort + single-item arrayMove commit target used for multi blocks); the identity-anchor + zone-clamp model that replaced them
metadata:
  type: project
---

# Zoned lists + identity-anchored DnD ordering (spec §6.1)

**Why:** user report "multi group dnd doesn't appear to order things correctly on drop in some cases". Two separate defects, only one of which was the one originally diagnosed.

**How to apply:** any future change to `dndMove.ts` ordering or `dndInsertion.ts` commit targets.

## The two bugs (both real, both in the same drop)

1. **Post-insert zone re-sort** (`moveGroupsMulti`/`moveGroup`/`moveWindow*`): the code inserted the
   block and THEN re-partitioned the whole list starred-first. That splits a mixed-zone selection
   and can slide the block away from the drawn gap.
2. **The one that actually produced the visible mis-order:** `computeInsertion` deliberately excluded
   groups from its multi-selection branch (`activeType !== 'group' && …`), so a multi-GROUP drag fell
   through to the SINGLE-item arrayMove target (`original[index]`, which includes the active). The
   engine's multi path meanwhile means "insert BEFORE the anchor". Those two disagree by one slot for
   any drop below the block — e.g. a non-contiguous block dropped past the last row landed one row
   too high. **Measured in the real popup**, not just reasoned about.

Bug 1 alone is nearly unobservable: once the selection is same-zone and the gap is zone-clamped, a
stable starred-first partition is idempotent. Re-adding the post-insert sort did **not** fail the new
property test; restoring the old insertion semantics failed 4 of its cases. Lesson: when two fixes
land together, patch each defect back in separately to find out which one the tests actually guard.

## The model that replaced it

- **Zones:** `zoneRank()` — starred 0, unstarred 1 — for both sidebar groups and a group's windows.
  A selection spanning both zones is refused in `canDrop` (`spansZones`), same treatment as a mixed
  TYPE selection. `DndProvider.attachInsertion` also suppresses the gap entirely for such a drag, so
  nothing is drawn for a drop that will be refused.
- **Identity anchor:** `blockInsertIndex(rest, anchor, after, blockRank, minIndex)` is the single
  ordering primitive. `rest` = list minus the block, zones normalised FIRST; anchor matched by
  **object identity** (groups by `id`), never by a raw index into the pre-removal array.
- **`DndRef.after` / `DndInsertion.commitAfter`:** how "at the very end" is expressed. The sidebar has
  no container droppable to append to (unlike a window list, which appends via its group row), so
  "past the last row" can only be said as "after the last row". `commitAfter` is left **undefined**
  for tab/window insertions on purpose — a single same-list tab/window drag still wants `dndMove`'s
  arrayMove direction derivation, and forcing `after:false` on it drops it one slot short. The
  handler therefore checks `insertion?.commitAfter !== undefined`, not `=== true`.
- **Clamping** happens in BOTH layers with the same formula: `dndInsertion.clampToZone` (so the gap is
  drawn legally) and `blockInsertIndex` (last line of defence). Same formula in both = gap == commit
  by construction.

## Gotchas found on the way

- `cloneGroup()` makes **new window objects**, so a window anchor resolved from the pre-clone state is
  never found again by `indexOf`. Resolve the anchor from the array you are about to mutate, before
  the removal (`windowAnchorIndex` + `dst.windows[i]`).
- `virtualDroppableRects` **deletes** collapsed selected rows from the rect map, so
  `attachInsertion`'s candidate loop silently drops them — which is why the group multi path appeared
  to work. Any check that needs to see selected rows (e.g. the cross-zone test) must run **before**
  the `droppableRects.get()` guard, since the containers list still has them.
- TS7022 (`'r' implicitly has type 'any' … its own initializer`) fires on
  `const r = c.zone ?? activeZone` when `activeZone` is a narrowed optional param. Annotate
  (`const r: number = …`) or copy the narrowed param to a `const` first.
- `isStructuralNoop` strips `updatedAt`/`pendingSync`, so switching groups to identity anchors (which
  makes `commitOverId === draggedId` impossible, killing the early release-in-place noop check) is
  safe — the release-in-place drop still bails as `'noop'`, just one step later.
- The real-popup gap can be read straight off the DOM: every non-dragged row at/after the gap carries
  a `translate3d` (`gapTransformFor`), so **gap index = (# non-dragged rows) − (# shifted rows)**.
  `drive()`'s `onMid` hook fires at step 5 of 8, which is NOT the final gap — the new
  `driveProbingEnd` helper probes after the last move (+250ms for the throttled `dragover`, spec C2)
  and before the release.
