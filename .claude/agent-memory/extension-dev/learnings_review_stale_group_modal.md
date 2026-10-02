---
name: review-stale-group-modal
description: Added Review modal + Archive-all for AI stale-group suggestion banner; reused Modal/ModalRoot + uiStore pattern
metadata:
  type: project
---

Added a "Review" action (opens a read-only group-contents modal) and an "Archive all" bulk
action to the AI stale-group suggestion banner (`AIGroupSuggestion.tsx`).

- Reused the existing `uiStore.openModal('type', data)` + `ModalRoot` switch pattern — added
  `'reviewStaleGroup'` to `ModalType` and a case in `Modal/index.tsx`, same as every other modal
  in the app. No new modal mechanism invented.
- Did NOT reuse `Windows/Tab.tsx`'s `TabItem` for the read-only tab rows inside the review modal —
  it's wired to `useSortable` (dnd-kit), several mutation hooks, and per-tab context menus, all of
  which are dead weight for a pure preview. Instead followed the existing lighter precedent,
  `Modal/ReviewStaleTabs.tsx` (used by the stale-tabs-cleanup banner), which already does a
  read-only favicon+title tab list without dragging in DnD/mutation deps.
- `handleArchive` in `AIGroupSuggestion.tsx` was refactored from `(groupId: string)` to
  `(groupIds: string[])` so both the single Archive button and the new "Archive all" button share
  one archive-then-update-storage code path (loop + single `remainingIds` filter at the end).
  Looping `archiveGroup(groupIndex)` calls sequentially against a snapshot `groupsState` is safe
  here because archiving only flips a group's `archived` flag — it never removes/reorders the
  `available` array, so indices found before the loop stay valid across all iterations.
- Test gotcha: shadcn `DialogContent` always renders its own sr-only "Close" icon button, so a
  modal's own explicit `<Button>Close</Button>` collides on `getByRole('button', { name: 'Close' })`
  in tests — use `getAllByRole(...)[0]` (same gotcha already noted in
  `learnings_url_rules_draft_save.md` for Save/Cancel at nested levels).
