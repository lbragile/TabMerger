---
name: learnings-phantom-temp-group-fix
description: Fixed orphaned "temp group" IndexedDB entries left by abandoned rename after Add Group; editValue is seeded from group.name synchronously so "unchanged" must be checked, not just "empty"
metadata:
  type: project
---

Bug: `handleNewGroup` in `SidePanel/index.tsx` persists a real group named `DEFAULT_GROUP_TITLE`
("temp group") immediately, then opens inline rename. If the user abandons rename (blur/Enter
with empty text, or the X cancel button) before typing a real name, the group survived forever —
visible in the sidebar, Copy-to-group menu, etc.

Fix in `GroupItem.tsx`: added `isAbandonedFreshGroup()` — true when `!group.permanent`,
`group.name === DEFAULT_GROUP_TITLE`, AND the current edit value is empty OR still equal to
`DEFAULT_GROUP_TITLE`. Both `handleRename`'s empty-commit path and the X cancel button now call
`useDeleteGroup()` instead of just `setRenameTarget(null)` when this is true.

Non-obvious gotcha: the rename `<input>`'s `editValue` state is seeded from `group.name` in a
`useEffect` that runs synchronously on `isRenaming` becoming true (only the `.focus()` call is
delayed via `setTimeout`). So on cancel-without-typing, `editValue.trim()` is NOT empty — it
equals `DEFAULT_GROUP_TITLE` verbatim. A check for `!editValue.trim()` alone misses this case
entirely; must also check `editValue.trim() === DEFAULT_GROUP_TITLE` to catch "user never edited
the field before cancelling."

Did not add a one-time cleanup pass for pre-existing phantom groups from before this fix — no
reliable signal distinguishes a genuinely-abandoned phantom from a group a user intentionally
still has named "temp group" with real tabs in it, and deleting user data speculatively is worse
than leaving a few stray entries. Existing phantoms need manual deletion by affected users.

Tests: `packages/extension/src/__tests__/unit/components/SidePanel/GroupItem.test.tsx` — added
cases for cancel-deletes-fresh-group (X button and empty-Enter), does-NOT-delete once a real name
is committed, and does-NOT-delete an existing/already-named group on empty cancel.

**Correction (2026-08-05):** the above fix was too aggressive — it wired `isAbandonedFreshGroup()`
into `handleRename` too, which fires on **blur** (not just explicit cancel). Any click-away from
the rename input (e.g. clicking into the group to go add tabs) counted as "abandoned" and silently
deleted the group the user just created, with no warning. Reported as: "adding a group with just
'temp group' name (no edits) causes it to delete right away."

Fix: `isAbandonedFreshGroup()` is now only consulted by explicit-cancel paths — the X button and a
newly-added Escape key handler on the rename `<input>` (Escape didn't previously do anything).
`handleRename` (blur and Enter) no longer deletes at all; it behaves exactly like renaming an
existing group — commit if `editValue.trim()` is non-empty (including leaving it as
`DEFAULT_GROUP_TITLE` verbatim if the user never touched the field), otherwise just close without
committing (name stays whatever it was). This matches the existing "blur with empty text on an
already-named group" behavior, which was already the reference pattern for revert-not-delete.

Net effect: the phantom-group problem this file originally fixed (orphaned groups from *explicit*
cancel) is still fixed. What's no longer true is "any abandoned rename gets deleted" — only
explicit cancel (X / Escape) deletes; blur/Enter always keeps the group, defaulting to
"temp group" if unedited.
