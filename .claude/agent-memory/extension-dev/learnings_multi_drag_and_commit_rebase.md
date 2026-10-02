---
name: learnings-multi-drag-and-commit-rebase
description: 2026-09-13 popup DnD — cancelQueries removed (write-gen re-read instead), drop commits against CURRENT cache via dndRebase, rbd-style multi-drag (selection registry, collapse extras, +N ghost, selection remap); harness gotchas for multi targets and headless viewport
metadata:
  type: project
---

# Multi-drag + commit-path audit fixes (2026-09-13)

Follows [[learnings-phase1-cross-group-active-group]] and [[learnings-dnd-collapse-instant-drop-probe]].

## Commit path (sync-conflict-auditor A1–A4)
- `cancelQueries` before the drop is GONE. TanStack hands a joining `fetchQuery` the raw
  retryer promise, so cancel rejected every group/bulk mutation that joined the fetch.
  Replacement: `localDb` write generation; a read overlapping an issued write re-reads.
  Mutation-checked: disabling the re-read fails `useDndHandlersRefetchRace.test.tsx`.
- Non-obvious: `setQueryData` refreshes TanStack's `#revertState`, so a cancelled
  ORIGINATOR fetch returned post-drop data anyway — only JOINERS were broken.
- The drop RESOLVES ids against `clonedRef` (geometry is drag-start) but COMMITS against
  `qc.getQueryData` via `rebaseMove` (`src/lib/dndRebase.ts`): live items by real id,
  saved by URL(s), nearest position, each current item claimed once; missing primary or
  target → no-op. Structural sharing keeps unchanged group objects `===` → free fast path.
- `saveGroupsState(next)` is issued BEFORE `setGroupsNow` (`const persist = …`).
- TanStack structural sharing: after `setQueryData(x)`, `getQueryData() !== x` in general.
  Tests must use `toEqual`, not `toBe`.
- No-op detection must include ids (two look-alike empty windows swapping is a real
  move); `previewSignature` (url+title) is too coarse — `isStructuralNoop` JSON-compares
  only changed groups minus `updatedAt`/`pendingSync`.

## Multi-drag architecture
- `dndMultiDrag.ts` registry is set in `onDragStart`, which dnd-kit 6.3.1 calls
  SYNCHRONOUSLY inside the sensor's `props.onStart` (verified in core.esm.js), so the
  sensor's ghost built right after already knows the count.
- `dndDragVisuals.ts` owns ghost + collapse/restore; the sensor only calls it (pointer
  sensor could reuse). Rows are found via static `data-tm-dnd-id` (= model id).
- Collapsed selected rows are DELETED from the virtual droppable map (a 0-height rect
  still wins `closestCenter`), and `canDrop` rejects a selected item as target.
- Clearing the store selection on an UNSELECTED pickup must be rAF-deferred: a selected
  window is an ancestor of a dragged tab (C4 abort class).
- `+N` badge must be top-LEFT: the row-width ghost hangs right of the cursor and its
  right edge is off-screen mid-panel (seen in a real-popup screenshot, not in jsdom).
- The sensor captures `requestAnimationFrame` in a module const at import → tests can't
  `vi.stubGlobal` it for collapse timing; wait real frames.

## Harness gotchas
- Multi-drag targets must be measured LIVE and twice: after pickup (collapse moves rows
  up), and again after entering the target list (the home list's gap growth goes away →
  rows below move up another row). Use untransformed layout top; assert the drawn gap
  (row `style.transform`) at release equals the commit.
- Headless toolbar popup viewport measured 670px wide vs the app's 800px → pre-existing
  130px doc overflow. Layout checks must compare against a no-selection baseline.
- ESLint 9 crashed repo-wide at the time (`minimatch expand is not a function`); since fixed by bounding the `brace-expansion` overrides per major.
