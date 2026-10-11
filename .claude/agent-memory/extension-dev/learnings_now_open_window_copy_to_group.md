---
name: learnings-now-open-window-copy-to-group
description: Window "Copy to group" from Now Open moved the card out of Now Open; useMoveWindow now copies whenever the source group is permanent, using dndMove's exported copyLiveWindow
metadata:
  type: reference
---

# Window "Copy to group" from Now Open is a real copy (fixed 2026-10-09)

**What was wrong:** `useMoveWindow` had no copy mode. With Now Open as the source it spliced
the live window out of `available[0]` (the card vanished until the next tab/window event
re-synced it, at the end of its zone), marked Now Open `pendingSync: true`, and appended the
live object itself to the saved group instead of a detached copy (`focused`, `starred`,
`pinned`, no `savedAt`).

**Fix:** inside the hook's mutation, `available[fromGroupIndex].permanent` selects the copy
branch: `copyLiveWindow(liveWindow)` (now exported from `lib/dndMove.ts`) is appended to the
target and the Now Open group object is not touched at all. The saved-to-saved branch and the
"target is Now Open" branch are unchanged.

**Decision: derive copy from the source group, no `copy` flag on the payload.** `useMoveTab`
takes `copy` from the caller (`Tab.tsx` passes `copy: isNowOpen`), but for a window there is
no valid "move a live window into a saved group" through this hook (closing real tabs is the
drag path's job, through `tabs.remove` side effects). Deriving it means both submenu items in
`Window.tsx` (a group, and "Create new group…" via `onCreated`) are right without a component
change, the existing component tests' exact payload assertions still hold, and a future
caller cannot forget the flag.

**Things to know when touching this:**
- `copyLiveWindow` is the one "live window → saved window" helper: `id: 0`, `focused: false`,
  tabs through `copyLiveTab` (`id: 0`, fresh `savedAt`, `pinned` dropped). The menu path calls
  it through `copyLiveWindowKeepingStar`, so a starred Now Open window is stored starred; a
  drag calls `copyLiveWindow` directly and lands unstarred. See
  [[saved-copies-and-positional-matching]].
- The copy lands where a saved-to-saved move lands: appended, then `sortWindowsByStarred`. A
  starred copy therefore sits after the target's starred windows and before its unstarred
  ones; an unstarred copy sits last.
- Undo: `useGroupsMutation` pushes the pre-copy snapshot, and `restoreSnapshotAsLocalChange`
  never takes Now Open from a snapshot, so undo only removes the copy from the target group.
  The drag-out path stays `undoable: false` because it closes real tabs.
- `Window.tsx`'s second dropdown (the "More window options" button) has no move/copy item;
  the only window-level callers of `useMoveWindow` are the two items in the header's
  right-click submenu.
- The hook-level regression test is in `src/__tests__/unit/hooks/useGroups.test.ts`
  (`describe('useMoveWindow')`, the "COPIES a Now Open window" case).
- A one-off probe test file must not be created inside the repo tree, even for seconds:
  use an assertion in an existing test file or the scratchpad.
