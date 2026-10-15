---
name: learnings-tour-tasks-on-practice-data
description: Guided tour "try it" steps beyond dragging (open, dedupe, select, search, undo) - how each stays on practice data, the practice-only undo history, menu items found by their visible text, needsFresh vs available, and why a search of the user's own is put aside
metadata:
  type: learning
---

**Three chapters share the practice groups** (`TOUR_DEMO_CHAPTERS`: drag, tabs, find). One effect keyed on
"in a practice chapter" owns everything that must hold for that whole stretch: the groups exist, "Open in
browser" opens nothing (`isTourOpenBlocked`, checked at the top of `useOpenWindow`), and the undo history is
the practice one. Its clean-up undoes all three, which also covers a finished or skipped tour.

**Practice-only undo history.** `uiStore.tourHistory` holds the user's own `undoStack` / `redoStack` while
those chapters are up; the live stacks start empty and their snapshots KEEP the practice groups.
`restoreSnapshotAsLocalChange(current, snapshot, { tourPractice: true })` takes only the practice groups from
the snapshot and everything else from the current state, so a practice undo cannot re-stamp or re-upload a
real group even if sync changed one meanwhile. Leaving puts the user's stacks back untouched. Decision: this
beats excluding practice changes from history, because every mutation calls `pushUndo` (which also clears
the redo side), so practice drags used to add empty entries to the user's history.

**The header's Undo / Redo go through `useUndoRedo`**, the path that restores a snapshot as a new local
change. A component that pops the stack and writes the raw snapshot bypasses that.

**`available` vs `needsFresh`.** `available(ctx)` false turns a step read-only, and it is asked on every
render. A condition the task itself changes (no repeated tab left once it was removed) must not be in there,
or the step flips to its fallback text the moment it is completed. Put it in `needsFresh`, which is only
asked when the step opens and swaps in a fresh practice set.

**Controls without an anchor.** Some components cannot be given a `data-tour` attribute cheaply. The tour
writes `data-tour-label` (the visible text) on every `[role="menuitem"]` and app-dialog button each frame
(`markTourLabels`), so a step can select `[role="menuitem"][data-tour-label="Open in browser"]`. Two gotchas:
JSX like `Remove {n} {word}` renders several text nodes (join the siblings), and a row whose text is split
into `<mark>` pieces for search highlighting has no stable label at all: ring the list instead of one row.

**Radix menus under the lock.** Items made `inert` are skipped by the menu's arrow-key navigation, so with one
unlocked item, Enter on the trigger lands focus on it directly. A step whose task opens a modal declares it
(`modal: 'deduplicateGroup'`), otherwise the tour steps aside the moment `uiStore.modal` is set.

**`role="alertdialog"`.** `TOUR_APP_DIALOG` is `:is([role="dialog"], [role="alertdialog"]):not([data-tour-card])`:
one compound selector, so it can be extended (`${TOUR_APP_DIALOG} > button`), which a comma list cannot.

**Search under the tour.** Practice groups are searchable only while a search step is up:
`isHiddenFromSearch` (pure, safe in render) plus `useTourSearchShowsDemo` (a `useSyncExternalStore` hook) for
whatever memoizes on it. A search query stays until it is cleared, so the tour clears what a search step had
the user type when the step is left, and puts a query the user already had aside for the whole run (in
"hide" mode it would hide the groups the steps point at), restoring it at the end. Effect order matters on
unmount: clean-ups run in declaration order, so the restore effect is declared after the step effect.

**Probing.** A quoted heredoc (`<<'EOF'`) keeps backslashes; JSON written through one still breaks on `\s`.
Write replacement scripts with the Write tool, or use JS template literals and avoid regex escapes.

Related: [[learnings-guided-tour]], [[learnings-tour-demo-groups-and-drag-steps]].
