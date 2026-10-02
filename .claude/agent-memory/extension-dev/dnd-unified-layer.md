---
name: dnd-unified-layer
description: How the reworked unified popup drag-and-drop layer is structured (model + pure move engine + provider), the spring-open dwell timer, and the legacy↔model selection-id mapping
metadata:
  type: project
---

The popup DnD was reworked into a normalized-model + pure-engine + provider stack.

**Why:** the old layer had per-panel `<DndContext>`s, string-encoded ids parsed by
`parseDndId` (`tab-{id}-{wi}-{ti}`), a drawn insertion line, a manual new-window
drop sentinel, and a per-window `useSortable` transform-blanking hack. It was
fragile across windows/groups. TDD red-phase tests defined the replacement.

**How to apply:**
- `src/hooks/useDndModel.ts` — pure `buildDndModel(groupsState): DndModel`. Synthesised
  ids ONLY: group = `group.id`; window = `${groupId}::w${i}`; tab = `${windowModelId}::t${i}`.
  Never key off `window.id`/`tab.id` (saved items are all `id:0`). Entries carry
  positional back-pointers (`groupIndex`/`windowIndex`/`tabIndex`). `permanentGroupId`
  is `''` when no permanent group exists.
- `src/lib/dndMove.ts` — pure `canDrop` + `applyMove`. `applyMove` NEVER calls chrome;
  Now Open moves return `DndSideEffect[]` (`tabs.move|tabs.remove|tabs.create|windows.create`)
  and `undoable:false`. All other moves bump both affected groups' `updatedAt`+`pendingSync`
  and are `undoable:true` (multi-item = ONE). Untouched groups kept by reference.
  - `moveTabsMulti` / `moveWindowsMulti` — anchor carries `selectionIds` (all one kind);
    the run is gathered sorted by (groupIndex, windowIndex[, tabIndex]), removed
    descending-per-window/group to avoid index drift, inserted contiguous, then
    `sortWindowsByStarred` re-runs on the target. Drop INTO Now Open = one
    `windows.create` per selected window, `undoable:false`.
  - LIVE Now Open window → saved group: `moveWindow` no longer NOOPs when
    `srcGi === permIndex` for a cross-group drop — it appends a detached copy
    (tabs `id:0` + `savedAt`, `focused:false`, `starred:false`), bumps the receiver,
    emits one `tabs.remove` per live tab, `undoable:false`. `available[permIndex]`
    is left untouched (Now Open re-syncs from the browser). Reorder *within* Now
    Open is still a NOOP (delegated to chrome by the handler).
- `src/hooks/useDndHandlers.ts` — the single commit hook. `onDragOver` sets a working-copy
  `overrideState` (reflow); `onDragEnd` reads pre-move state, runs `applyMove`, then
  `qc.setQueryData` **before** `await saveGroupsState`. Resolves refs by map lookup.
  - **Spring-open dwell timer (item 6):** `onDragOver` is event-driven, not time-driven,
    so a `setTimeout(600ms)` is armed the first time a NEW group row becomes the `over`
    target during a `tab`/`window` drag (never `group` drags), and cleared whenever
    `over` changes / drag ends / cancels (`clearSpring()` in `reset()`). Guard:
    `overId !== model.permanentGroupId && overGroup.index !== activeGroupIndex`.
    `springOverIdRef` holds the currently-armed row id so repeated `onDragOver` calls
    for the same row don't re-arm → fires exactly once. Fires `setActiveGroupIndex(overGroup.index)`.
  - **Store-driven multi-select promotion (item 7):** `uiStore.selectedItems` holds
    LEGACY ids (`tab-{gi}-{wi}-{ti}` | `window-{gi}-{wi}` | `group-{gi}`, `gi` indexes
    `available`). `useDndModel.ts` exports pure `legacySelectionIdToModelId` /
    `modelIdToLegacySelectionId`. In `onDragStart`: if no explicit
    `data.current.selectionIds`, and the dragged model id maps back to a legacy id
    present in `selectedItems`, and all `selectedItems` share the drag's type, then
    `active.selectionIds` = the full set mapped to model ids (selectedItems order).
    dnd-kit's `active.data.current` can't be mutated from `onDragStart`, so
    `selectionIds` rides on the `DndActive` state + an `activeRef`; `onDragOver` /
    `onDragEnd` copy `activeRef.current.selectionIds` onto the resolved `DndRef`
    when the raw `data.current` lacks them, so they reach `canDrop` (mixed-type
    reject) and `applyMove`. NOT gated on `selectionMode`.
  - Read uiStore slices via the selector form with a fallback
    (`useUIStore((s) => s.selectedItems) ?? EMPTY`), never `useUIStore.getState()` —
    several suites mock the store as a bare selector fn with no `.getState`.
- `src/components/dnd/DndProvider.tsx` — renders exactly ONE `<DndContext>` + ONE
  `<DragOverlay>`, wrapped in a `data-testid="dnd-provider"` `display:contents` div.
  Nesting-aware: a nested `<DndProvider>` is a passthrough. `App.tsx` hoists ONE
  provider around `<SidePanel>` + `<main>/<WindowsPanel>`; `Windows/index.tsx` keeps
  its nested one for standalone tests. `GroupItem` + non-anchor selected rows read
  `useDndContext()` → dim to `opacity:0.4` when `isDragging && active.selectionIds`
  includes this row's model id and `active.id !== thisId`.
- `SidePanel/index.tsx` no longer hosts a `<DndContext>` — only a
  `<SortableContext items={group.id[]}>`. Sensors/collision/handlers come from the
  hoisted provider. `GroupItem` registers `useSortable` AND `useDroppable` both under
  `group.id` with `data:{type:'group',groupId,index}`, so a window/tab can land on a
  group row (cross-group move). Permanent "Now Open" stays non-draggable (no
  attributes/listeners spread, grip hidden); the engine's `canDrop` blocks
  reorder-of / drop-before it.
- `@/hooks/useDnd` keeps `useDndSensors` + `setBodyDragCursor` and re-exports the
  handlers via `export * from './useDndHandlers'` — a NAMED `export { useDndHandlers }
  from …` there collides with `DndProvider`'s direct `@/hooks/useDndHandlers` import
  in WXT/unimport auto-import scanning ("Duplicated imports" build warn). `export *`
  keeps `@/hooks/useDnd` a valid runtime import site without a second auto-import entry.
- Legacy `useGroupDndHandlers` / `useWindowDndHandlers` / `parseLegacyDndId` are
  DELETED from `@/hooks/useDnd`. `src/__tests__/unit/hooks/hooks.test.ts` still
  imports the two hooks (12 tests) — left for `test-writer` to reconcile in green phase.

**Deferred / not yet done:** edge auto-scroll tuning beyond `autoScroll={{threshold:{x:0,y:0.2}}}`.
