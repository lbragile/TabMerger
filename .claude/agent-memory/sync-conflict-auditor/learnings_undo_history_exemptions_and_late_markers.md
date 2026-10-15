---
name: undo-history-exemptions-and-late-markers
description: Audit checks for exceptions to "clear undo history on a foreign write" and for sync markers written outside the groups write queue
metadata:
  type: reference
---

Two audit checks for undo history and sync.

**1. An exemption from clearing history has to end when the action it covers ends.**
The popup clears its undo history whenever another context broadcasts `TM_GROUPS_CHANGED`. Any exemption ("this write is part of my own action") is keyed on something, such as a tab id or a request id. Compare how long that key lives with how often the exempted event fires:
- The URL-rule engine runs on `tabs.onCreated` AND on every `tabs.onUpdated` with `status: 'complete'`, so it runs on each navigation, reload or redirect, not just the tab's first load.
- The popup page can also be opened as an ordinary tab and stay open for hours.
- An undo snapshot that survives an unrelated write reverts that write when it is restored, and `restoreSnapshotAsLocalChange` re-stamps the group, so the revert is pushed to the server.

**2. Check the ordering of sync markers written outside the groups write queue.**
`writeGroupsState` adds and removes pending-delete ids in the same transaction as the local change. Any other writer of the same marker that runs after an `await` (for example `supabase.auth.getSession()`, which can refresh the token over the network) can land after a later write that has to win, such as an Undo restoring the groups.

The merge drops every pending-delete id (`continue`), so a marker that is set again prunes the restored group locally and deletes it remotely. For these paths, look for a test where the undo lands between the write and the late marker. A test that awaits the delete first does not cover this ordering.

Related: [[learnings_groups_write_queue_constraints]], [[learnings_filtered_index_and_set_aside_state]].
