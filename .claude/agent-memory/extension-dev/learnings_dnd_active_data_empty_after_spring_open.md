---
name: dnd-active-data-empty-after-spring-open
description: Pointer DnD showed no insertion gap in a spring-opened group because dnd-kit's args.active.data.current becomes {} once the source row unmounts; fixed with withStableActive in DndProvider
metadata:
  type: project
---

User report: mouse DnD cross-group, after spring-open "re-ordering doesn't show anything" (no gap). Same-group worked.

**Root cause:** `args.active.data.current` comes from the dragged row's own `useSortable` registration. Spring-open swaps the windows panel, the source row unmounts, and dnd-kit hands collision detection `active.data.current === {}` for the rest of the drag. `unifiedCollision` (`sameTypeOnly`), `attachInsertion` (returns hits with no `tmInsertion`) and `virtualDroppableRects` (growth line) all key off the active TYPE, so all went inert. Found by logging `args.active.data` in `unifiedCollisionWithInsertion` (aType null, aData "{}"), after a first `__tmErr` probe showed `attachInsertion` returning early without an error.

**Fix:** `withStableActive(args)` at the top of `unifiedCollisionWithInsertion` (DndProvider.tsx) replays the last non-empty data captured for the same active id. Not a regression from e88a06c: present since the gap model (88f2e48 / 06ccc7a).

**Side finding:** this is also why the C15 `sameTypeOnly` window-fallback "never fired" in the earlier spring-open window-drop investigation (activeType was undefined there, so window drags were not type-filtered at all). The `commitDrop` model redirect remains correct and is kept.

**Rule:** never read the active item's type/data from `args.active.data` alone in any code that can run after the panel swap; commit paths use `resolveRef(model, id, data)` which falls back to the id, collision paths need the cache.

Regression: `e2e/tests/popup-dnd-spring-open-gap.spec.ts` (control + tab + window; asserts translate3d on rows, calc() padding on the list, and the persisted order) and `__tests__/unit/components/dnd/stableActive.test.ts`.
