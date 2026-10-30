---
name: learnings-ai-menu-sections-describe-group
description: Header ✨ AI menu moved to Header/AiMenu.tsx with scope sections (DropdownMenuGroup + labelled DropdownMenuLabel) and a credits footer; "Describe group" note write with a targeted toast Undo (undoHistoryEntry); Git Bash path conversion mangles "//" script args
metadata:
  type: reference
---

**Where.** `components/Header/AiMenu.tsx` owns the AI dropdown and its handlers (Header keeps only
the quota-prompt state, passed as `onQuotaExceeded`). Sections are `DropdownMenuGroup
aria-labelledby={labelId}` + `DropdownMenuLabel id={labelId}` (Radix renders `role="group"` and a
plain div label: labels are never menu items; RTL `getAllByRole('group')` + `toHaveAccessibleName`
tests them). Sections are built as an array and joined with separators, so a section whose items
are all switched off leaves no doubled separator. The selected-group label puts the name in a
`<bdi className="normal-case tracking-normal …">` via `<Trans>` so the label's `uppercase` doesn't
uppercase the user's group name. Footer: plan line as a `DropdownMenuLabel` that the "AI settings"
item references with `aria-describedby` (screen readers skip loose text inside role=menu).

**Describe group.** `hooks/useDescribeGroupAction.ts`: `useDescribeGroupAction(group)` (blocks
reuse `NameGroupBlock`) and `useSaveGroupNote()`. The reply is cleaned by
`lib/groupDescription.ts` (`cleanGroupDescription`: control + bidi controls out, whitespace
collapsed, capped at shared `AI_MAX_GROUP_DESCRIPTION_LENGTH`). After the reply arrives the group
is re-found BY ID in the query cache (the request takes seconds; the order or the note may have
changed): empty/whitespace note → `useUpdateGroupNote` at the current index; otherwise
`openModal('describeGroupReview', { groupId, description })`. "Add below" is disabled when the
result passes `GROUP_NOTE_MAX_LENGTH` (500, the note editor's limit, now a shared constant).

**Toast Undo that undoes only its own step.** Capture `undoStack[0]` before and after the write;
the new top is the step (none when unchanged). `undoHistoryEntry(qc, entry)` (useUndoRedo.ts)
runs the normal cursor move with an `only` entry: inside the write step it refuses when the top is
no longer that entry, so a later change is never undone by an old toast. Exported as a plain
function (not through `useUndoRedo`) so per-row hooks don't subscribe to the stacks.

**Mocks follow hook usage** ([[test-mocks-follow-hook-usage]]): rendering Header or
GroupContextMenu now needs `useDescribeGroup` in `vi.mock('@/hooks/useAI')` and
`useUpdateGroupNote` + `GROUPS_QUERY_KEY` in `vi.mock('@/hooks/useGroups')`; Header tests also mock
`@/hooks/useAiUsage` (the footer reads it).

**Git Bash path conversion.** A script argument starting with `//` (e.g. a `// ─── comment`
anchor passed to a Python insert script) is rewritten to `/ ───` by MSYS before the script sees
it, so the insert lands one character into the comment. Put anchors inside the script file, or
use `MSYS_NO_PATHCONV=1`.

Related: [[learnings-header-ai-name-group]], [[learnings-undo-history-in-write]], [[learnings-uistore-single-modal-slot]]
