---
name: sync-server-stamp-and-merge-shape
description: Facts to check any sync change against - server-stamped updated_at, compare-and-swap pushes with a stored base stamp, the production cycle shape, keyset paging on a global text id, per-request timeouts, and which identity a request actually runs as
metadata:
  type: reference
---

- `groups.updated_at` is stamped by a BEFORE UPDATE trigger; the client value only survives an INSERT. Migration 020 keeps it unchanged for position-only and view-count updates. Local `updatedAt` (client clock) and the server stamp are different clock domains: decisions compare the stored base (`remoteUpdatedAt`, the server's string) with the row's stamp via `lib/stamp.ts`, never the two clocks.
- Pushes are compare-and-swap: base known = `update().eq('updated_at', base).select()`, zero rows back = changed elsewhere (nothing overwritten, the merge resolves it); no base = `insert` (23505 = the id already exists). Position-only pushes carry no content and need no key.
- Cycle shape (`runSyncCycle`, under the cross-context sync lock): push -> flush pending deletes -> paged fetch (all network, outside the groups write queue) -> ONE `updateGroupsState` with the pure `mergeRemoteGroups` on a fresh read. A failed page returns before the merge, so nothing derived from the pull (delete confirmation, seeded flag) is written. `pullRemoteChanges` is test-only.
- Merge rules worth re-checking after any change: a pending local copy is never replaced silently (equal content = adopt the stamp, different = server copy + a pending conflict copy with a new id); "clean and absent from the pull's ids" = deleted remotely; a row that is present but cannot be decoded stays in `ids` and resolves nothing.
- `groups.id` is `text primary key` (nanoid), unique across ALL users, not per user. Keyset paging (`.gt('id', last).order('id').limit(n)`) is stable because the id never changes and filter and order use the same column collation. The page-size constant must not exceed the server's `max_rows`, or a capped first page looks complete.
- Every cycle request carries a fresh `AbortSignal.timeout` (`lib/syncRequest.ts`). The bound is per request, so a cycle's worst case scales with the number of requests it makes.
- A request runs as whatever session the Supabase client holds WHEN IT IS SENT, not as the `session` object the cycle was started with; without a session the client sends the anon key and RLS filters rows instead of returning an error. Rows written by a cycle carry the cycle session's `user_id`, so RLS rejects a write sent under another identity.
- Fire-and-forget side effects inside an `updateGroupsState` callback start before the write transaction; fine only when the write records the same state atomically.
- Positions: the pushed `position` is the local array index (Now Open is 0 and never pushed); `writeGroupsState` derives `positionDirty` from the stored order, so index-shifting mutations need no per-mutator code.
