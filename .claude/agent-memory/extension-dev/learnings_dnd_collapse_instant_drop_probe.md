---
name: learnings-dnd-collapse-instant-drop-probe
description: MEASURED native-drag abort boundary (dispatch, not time), collapsed-source + pointer insertion-gap model, single-paint drop (flushSync + sync TanStack notify + transition hold), dnd-kit `active.rect.initial` is LIVE, and the flag-gated pointer-stream probe
metadata:
  type: project
---

# Source collapse, instant drop, pointer probe (2026-09-12)

Follow-up to [[learnings-mv3-popup-native-html5-dnd]] and [[learnings-dnd-ghost-prominence-and-cursor]].

## The abort "early window" is the dragstart DISPATCH, not a time window (measured)
`e2e/repro/popupAbortWindow.repro.ts` injects a document-capture script into the REAL
popup and applies ONE mutation at a chosen time after `dragstart` (no app changes),
recording whether `drop` fires. Results:
- row `height:0` / `display:none` / `row.remove()` / a sibling overlapping the source via
  negative margin → ABORT when done synchronously in the dispatch **or in a microtask
  queued from it** (`queueMicrotask`). The same mutation in `setTimeout(0)`, rAF, t60…t600,
  1st/3rd `drag`, 1st `dragover` → SURVIVES.
- attribute-only change on the row, or `display:none` on an UNRELATED row → survives even
  synchronously.
- Interpretation: Blink's `DragController::StartDrag` hit-tests the drag origin once, when
  dispatch returns — if the source isn't under the origin any more, no drag. React's
  discrete-event commit lands in that microtask checkpoint → that's why React commits of
  `isDragging`/DragOverlay aborted, and why "~60ms" was a misread.
- Also measured: the renderer paints NOTHING for ~210ms after `dragstart` (first rAF,
  timers and `drag` all land at ~215ms) in the headless real popup.
- Detaching the source → `dragend` goes to the detached node only; document-capture
  listeners miss it. The sensor now ALSO listens on the source node (deduped).

## dnd-kit gotcha: `active.rect.current.initial` is NOT the initial rect
`activeRects.current = { initial: draggingNodeRect, translated: collisionRect }` —
`draggingNodeRect` is the LIVE `useRect(activeNode)` (ResizeObserver). Collapse the source
and `initial.height` reads 0. Sensor publishes its own measured outer height
(`getDndDragSourceHeight()`). Also: `display:none` makes `useRect` a 0×0 rect at (0,0)
→ rect-based collision fallbacks drift to the corner; collapse with `height:0 !important`
(keeps top/left/width) instead.

## Collapsed-source model
FIRST ATTEMPT FAILED in the real popup (kept here as the lesson): transform-only gap +
permanently shrunken home list + one-shot droppable re-measure. (a) coordinates below the
home list moved up by h, (b) an end-of-list gap pushed the last row outside its window
(`overflow-hidden` clipped it), (c) the re-measure only partially landed — sortable's own
ResizeObserver re-measured the resized window rows but not tabs inside the next window, so a
window drag hit a STALE tab rect and committed nothing. Replaced by the rbd placeholder model
(list holding the gap gets `padding-bottom: h`; virtual collision geometry from the
drag-start snapshot, measuring back to BeforeDragging) — see below.

- Sensor collapses the row in the first rAF (never in dispatch), after dispatching
  `tm-dnd:source-collapse {height}`; provider `flushSync`s the initial gap (later siblings
  shifted) in that listener so collapse + shift share one style recalc.
- `verticalListSortingStrategy`/arrayMove-against-`over` are wrong once the source has no
  slot (pick up + release in place moved it down one). `@/lib/dndInsertion` computes the
  insertion index from the dragged item's CENTER vs each other item's collapsed center
  **+ gapHeight/2** (midpoint between adjacent gap positions → half-row dead zone), plus
  `shiftIds` (rows to translate) and `commitOverId` (same list: item originally at the
  index → arrayMove; foreign tab list: item after the gap, or the window id to append).
  Attached as `collisions[0].data.tmInsertion` by `unifiedCollisionWithInsertion`, read in
  `onDragMove`/`onDragEnd` — so the visible gap and the commit can't disagree.
- dnd-kit `SortableContext` sets `disableTransforms` for a container that doesn't hold the
  active item → a foreign-list gap is impossible via a strategy; rows render
  `gapTransformFor(gap, id)` from our own context instead (dnd-kit transform only when no
  collapsed drag is live, e.g. keyboard).
- NO droppable re-measure (that was the failed first attempt). The list holding the gap
  gets `padding-bottom: +h` (`gapGrowthFor`/`dndListStyle`, `[data-tm-dnd-list]` wrappers),
  so the home list keeps its size while the gap is home. Collision runs on
  `virtualDroppableRects`: dnd-kit's DRAG-START rect snapshot, minus h below the collapsed
  source, plus h below the gap list's last row, both only within the same column
  (horizontal overlap). Measuring stays BeforeDragging (1). Note `BeforeDragging` disables
  `measureDroppableContainers` mid-drag, and core `useDndContext()` can't be used in
  `DndProvider` (~6 component tests render it under partial `@dnd-kit/core` mocks).
- CDP harness gotcha: a press helper must move ≥ ~4px or no native `dragstart` fires; a
  3px wiggle silently tests nothing (row never collapses).
- Escape can't be verified over CDP: `Input.dispatchKeyEvent` never reaches the native drag
  loop (drag continued and committed on release). Only the in-page keydown cancel path is
  unit-tested.

## Single-paint drop — all three suspected causes CONFIRMED by frame sampling
Frame sampler (ResizeObserver on a sentinel toggled each rAF → samples AFTER all rAF
callbacks, just before paint) + `Page.startScreencast`, before the fix:
1. `stopGhost()` before `props.onEnd()` → first post-drop frame showed ghost gone and the
   source visible at its OLD slot, old order.
2. new order painted one frame later: dnd-kit's reset render (DefaultLane) landed before
   TanStack's notify. TanStack: `QueryCache.subscribe` listeners fire synchronously inside
   `notifyManager.batch`; the DEFERRED path is `observer.subscribe(notifyManager.batchCalls(…))`
   (what `useBaseQuery` uses) → `scheduleFn` = `setTimeout(0)`.
3. hardcoded `transition: transform 200ms` → 24 frames of sibling slide.
Fix: sensor `finish()` = hold `data-tm-dnd-instant` on `<html>` (CSS kills row transitions
for 2 frames) → `flushSync(props.onEnd)` → THEN restore ghost/row. `onDragEnd` uses
`setGroupsNow` (`notifyManager.setScheduler(cb=>cb())` around `setQueryData`, restore
`defaultScheduler`). All exported from `@tanstack/react-query`.

## Pointer-stream probe (diagnostic, not shipped behaviour)
`@/lib/dndPointerProbe`, flag `localStorage.tm_dnd_pointer_probe === '1'` read at popup load
(`DND_POINTER_PROBE_ACTIVE`). Unset → `installDndPointerProbe()` adds zero listeners. Set →
grips lose `draggable`, `useDndSensors` omits `Html5DragSensor`, one `[tm-dnd-probe] {…}` line
per grip press (console + selectable chip via `showDndDebugChip` + last 10 in
`localStorage.tm_dnd_pointer_probe_log`), alternating no-capture / `setPointerCapture`.
Needs a HUMAN run in the real toolbar popup — CDP input can't reproduce hardware input.
