---
name: delete-resurrection-race
description: Root cause and fix for deleted groups reappearing — fire-and-forget deleteRemoteGroups racing pullRemoteChanges
metadata:
  type: project
---

Bug: deleting a group (single via `useDeleteGroup` or bulk via `useBulkActions`'s `type === 'group'`
branch) sometimes "came back." Root cause: both callers do
`deleteRemoteGroups([id]).catch(() => {})` — fire-and-forget, never awaited — while the local
IndexedDB removal happens synchronously. `useSync.ts`'s 30s poll / online-event / mount pull
(`pullRemoteChanges` in `syncEngine.ts`) can race ahead of the DELETE actually landing on
Supabase: it sees the row still remote, sees it absent locally, and resurrects it via the
`else if (remote)` merge branch.

Fix: added a persisted (IDB `settings` store, key `pendingDeleteGroupIds`, via existing
`getSetting`/`setSetting` — no new object store) pending-delete id set in `syncEngine.ts`.
`deleteRemoteGroups` marks ids pending *before* the network call. `pullRemoteChanges` treats any
pending id as absent from both remote and local for that merge pass (`continue` in the `allIds`
loop), and self-heals by dropping an id from the pending set once a pull confirms the row is
actually gone remotely. This closes the race for both single and bulk delete in one shared place
— no change needed in `useGroups.ts` or `useBulkActions.ts` themselves.

Also found and fixed a stale/wrong comment in `subscribeToRemoteChanges`
(`"Deletions are represented by the archived flag, not hard deletes in Supabase"`) — false;
`deleteRemoteGroups` does a real `.delete().in('id', ids)`. Replaced with accurate comment.

**Scope:** this fix covers the same-device race only (the pending set is local to the deleting device).

Test pattern for this class of bug: build the `localDb` mock's `getSetting`/`setSetting` as an
in-memory `Record<string, unknown>` (not just `vi.fn()` returning defaults) so state actually
persists across the two calls under test (mark-pending in `deleteRemoteGroups`, then read/clear
in `pullRemoteChanges`) — a stateless mock can't prove the self-heal cleanup path works.
