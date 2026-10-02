---
name: url-rules-orphan-cleanup
description: Fixed group delete (single + bulk) not cleaning up UrlRule.groupId references; undo stack decision
metadata:
  type: project
---

Bug: `UrlRule` (lib/types.ts) stores `groupId` but lives in a separate flat settings key
(`getSetting('urlRules', [])` via useUrlRules.ts), not nested in `GroupsState.available`.
Neither `useDeleteGroup` (useGroups.ts) nor `useBulkActions`'s group-delete branch ever
touched it, so deleting a group left orphaned rules pointing at a dead groupId.

Fix: added `deleteRulesForGroupIds(groupIds: string[])` to useUrlRules.ts (read-modify-write
over the same settings key, matching useSaveUrlRules's pattern) and called it from both
delete paths — `useDeleteGroup` (single id, fire-and-forget after `mutate()` resolves) and
`useBulkActions`'s group branch (batch of `deletedGroupIds`, alongside the existing
`deleteRemoteGroups` call).

Runtime safety check: `urlRuleEngine.ts`'s `applyUrlRule` already no-ops safely
(`if (!group) return`) when a rule's groupId doesn't resolve — so the orphan was dead data,
not a crash risk. Worth confirming this kind of runtime guard before treating orphaned-FK
bugs as urgent.

Undo decision: did NOT make rule cleanup undo-aware. The undo/redo stack in uiStore.ts only
snapshots `GroupsState` — it has zero awareness of the separate `urlRules` settings key, so
undoing a group delete already can't restore anything outside `GroupsState` today. Extending
undo to cover a second, unrelated store would be a scope increase beyond this bug fix, not a
consistency requirement it already had. Documented as a `ponytail:` comment on the helper.
