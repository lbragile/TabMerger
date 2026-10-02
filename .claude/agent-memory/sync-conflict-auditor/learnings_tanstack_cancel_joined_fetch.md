---
name: learnings-tanstack-cancel-joined-fetch
description: TanStack query-core 5.101 gotcha. cancelQueries returns reverted data only to the fetch's originator; fetchQuery callers that joined the in-flight fetch reject with CancelledError.
metadata:
  type: project
---

In `@tanstack/query-core` 5.101.2, `query.fetch()` gives a caller that joins an already-running fetch the raw `#retryer.promise` (query.js ~line 192). `cancelQueries` defaults to `revert: true`. The originator's `fetch()` catches the resulting `CancelledError` and returns the reverted `state.data` (~line 312). A joined caller doesn't get that treatment: its promise just rejects with `CancelledError`.

In this repo, `useGroupsMutation` (useGroups.ts) and `useBulkActions` call `qc.fetchQuery({queryKey: GROUPS_QUERY_KEY})`. If they join a `useGroups` refetch that gets cancelled, the user's mutation is dropped.

Cancelling also never stops the queryFn itself. `getGroupsState` ignores the abort signal, so the IDB read still runs to completion, and so does any write it triggers (the `savedAt` migration write in `getGroupsStateWithMigration`).

**`invalidateQueries`/`refetchQueries` do the same by default.** Verified 2026-09-14 in 5.101.2:
- `refetchQueries` sets `cancelRefetch: options.cancelRefetch ?? true` (queryClient.js:168).
- `Query.fetch` with data present and a fetch in flight calls `cancel({silent:true})` (query.js:188).
- A joiner holding the old retryer promise from query.js:192 rejects with a silent CancelledError. Only the originator is re-pointed at the new promise (query.js:311).

So `void qc.invalidateQueries({queryKey: GROUPS_QUERY_KEY})` can drop a concurrent `fetchQuery`-based mutation. Pass `{ cancelRefetch: false }` whenever a groups fetch may be joined.

**Why:** a `cancelQueries` added before the DnD commit in the 2026-09-12 fix looked harmless but had this side effect; it was replaced by a write-generation re-read in `getGroupsState` (fixed 2026-09-13).
**How to apply:** when a change adds `cancelQueries` on GROUPS_QUERY_KEY, check for concurrent `fetchQuery` mutations. Suggest a write-sequence check inside `getGroupsState` that re-reads when a write landed mid-read, rather than cancelling.
