---
name: learnings-tour-demo-groups-and-drag-steps
description: Guided tour drag chapter - the "Tour demo" practice groups (one flag, one predicate, where every consumer filters them), the sealed DnD sandbox in canDrop, how drag steps run under the tour lock, ring styling rules, and the Radix aria-hidden marker gotcha
metadata:
  type: learning
---

**Practice data.** `lib/tourDemo.ts` makes two groups with FIXED ids (`tour-demo-1`, `tour-demo-2`) and `tourDemo: true`.
`isTourDemoGroup` (in `@tabmerger/shared`) is the only test. They exist exactly while a step of the chapter
`TOUR_DRAG_CHAPTER` is on screen: an effect keyed on "in the drag chapter" adds them and its clean-up removes them,
which also covers a finished or skipped tour (the overlay unmounts). A popup closed mid-chapter cannot clean up, so
`Tour` removes them once per popup open unless the stored record resumes in that chapter. Clean-up finds them by flag
or fixed id, never by an id read from storage (a stored value must not be able to name a real group).

**Choke points beat call sites.** The exclusions that matter are in three places, not in the UI:
- `writeGroupsState` (localDb): a practice group is stored with no sync mark whatever the caller set, its removal is
  never added to the pending remote deletes, and a group's synced position is its index among NON-practice groups
  (so adding or removing practice groups marks no real group `positionDirty`).
- `mergeRemoteGroups` (syncEngine): a local-only group with `pendingSync: false` reads as "deleted on the server" and
  is dropped. Practice groups must be kept there explicitly, like the permanent group.
- `uiStore` history: snapshots are stored without practice groups, and `restoreSnapshotAsLocalChange` keeps the
  current ones, so an undo neither removes them mid-tour nor brings them back later.

**Sealed sandbox.** `canDrop` refuses any move where a practice item or practice target is involved unless ALL
dragged items and the target are practice data. Because keyboard move mode builds its target list from `canDrop`,
the keyboard walk only ever offers practice targets: no extra tour code. `inert` does NOT stop a drop: dnd-kit
collisions are geometric, so a locked row is still a drop target. Enforce drop rules in the engine, not with the lock.

**Drags under the tour lock.**
- Unlock only the drag handles (`[aria-label^="Drag to reorder …"]`) plus the keyboard move's hidden focus holder
  (`KeyboardMoveHost`, marked `data-tour-no-tab` so the Tab cycle skips it). A handle only gets press, drag and plain
  Space (`dragOnly`): click, double click, right-click and other keys are swallowed.
- While `isDndDragLive()` the tour's key listener, its root quarantine listener, the re-lock and the focus hand-back
  all stand down: the move owns the keyboard (Escape cancels the move, not the tour).
- There is no dnd-kit KeyboardSensor in this popup. Keyboard moves are the app's move mode; its announcements go to
  `#tm-dnd-live-region` inside `#tm-dnd-aux-host`, a child of `<body>`, so the lock never silences them.
- Sub-step of a drag = live state read each frame: not dragging, dragging, dragged copy over the destination
  (middle of `[data-testid="drag-ghost"]` inside the destination, or `data-tm-move-cursor` on it).

**Ring styling.** Rings are box-shadows on a padded box, tokens only. Orange `--secondary` is about 2.3:1 on white,
so a coloured line always carries one text-colour hairline. One thing pulses at a time: the action ring, else the
region, and the drop marker only while dragging. A ring glides only for a moment after its TARGET changes
(state set during render so the attribute lands with the new position); while it follows a target it must not ease.

**Radix `aria-hidden` marker gotcha.** `hideOthers` marks what it hid with `data-aria-hidden` only on the first
layer. When a menu and then a dialog open back to back, the dialog hides the same nodes WITHOUT the marker. To keep
a portal's controls exposed, strip `aria-hidden` from the known nodes (the card's direct children), not by marker.

**Probing.** `wxt build -c <config outside the repo>` with a config that spreads the real one and sets `outDir`
builds into a temp folder without touching `.output`. Heredocs in this shell eat backslashes: write scripts with
the Write tool.

Related: [[learnings-guided-tour]], [[dnd-unified-layer]], [[learnings-keyboard-move-list-mode]].
