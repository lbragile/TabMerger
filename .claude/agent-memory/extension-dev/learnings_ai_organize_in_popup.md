---
name: learnings-ai-organize-in-popup
description: AI Organize is reviewed and applied in the popup (OrganizeReview modal, applyOrganizeActions, useApplyOrganize); bulk-mutation pattern outside useGroups.ts; e2e gotchas (Chrome a11y name pads inline-block bdi, Now Open id changes on sign-in); text-ui-start guard
metadata:
  type: reference
---

**Shape.** `useOrganizeTabs` (hooks/useAI.ts) returns `{ actions }` run through
`sanitizeOrganizeActions(reply, groups)` (lib/organizeActions.ts): untrusted AI output, so
malformed items, unknown ids, permanent (Now Open), tour practice and pointless actions (same name,
same order, archive of archived, merges with archived groups as in the banner's Merge) are dropped
and names go through `cleanSuggestedName` (moved to lib/aiGroupName.ts, shared with "Name group").
Header opens `openModal('organizeReview', { actions })` or toasts "already organized".

**One mutation without touching useGroups.ts.** `useGroupsMutation` is not exported; the
precedent for writing outside it is `useBulkActions`' `updateWithUndo`:
`updateGroupsState(fn, { afterWrite: recordStep({ push: pushUndo }) })` then
`qc.setQueryData(GROUPS_QUERY_KEY, next)`. `useApplyOrganize` does exactly that with the pure
`applyOrganizeActions(fresh, actions)` (ids re-checked on the fresh read; `null` = no write, no
step). Capture the transform's side info through a holder object (`const out: { result? } = {}`):
a `let` assigned inside the callback is narrowed to `null` by TS after the await.

**Conflict order** (doc comment on `applyOrganizeActions`): merges, renames, archives, reorder;
an action whose group is gone is skipped; merge targets follow earlier merges (A→B then B→C lands
in C, `mergedInto` is chain-resolved for URL rules); AI `delete` is ARCHIVE. Merged-away groups
get `deleteRemoteGroups` (the write also records them as pending deletes while cloud sync is on);
archive pushes `archived: true`; reorder only flags positions (no `updatedAt` bump). Proven with
real IDB + fake Supabase in `integration/organizeApply.integration.test.ts`.

**Gotchas hit:**
- Chrome's accessible name puts spaces around an `inline-block` `<bdi>` inside a label
  (`Merge “ A ” into “ B ”`); jsdom does not. Unit tests can match the exact name, e2e needs a
  regex with `\s*`.
- e2e: after `signInAsPro`, Now Open is re-created under a new id, so a stub that names
  `NOW_OPEN.id` names an unknown group. Read Now Open's id from the request body (`permanent: true`).
- `logicalDirection.test.ts` fails any `text-ui-start` whose tag (or the 3 lines above) has no
  `dir=`; use `text-start` for UI text.
- A running `wxt` dev server owns `.output/chrome-mv3-dev`: build the e2e extension into the
  scratchpad (see [[learnings-in-app-confirm-and-backup-file-location]]) and run with
  `TM_E2E_EXT_DIR`.

Related: [[learnings-header-ai-name-group]], [[learnings-undo-history-in-write]], [[learnings-groups-rmw-lock]]
