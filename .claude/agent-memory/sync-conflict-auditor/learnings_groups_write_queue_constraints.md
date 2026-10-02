---
name: learnings-groups-write-queue-constraints
description: Non-obvious constraints of localDb's groupsWriteTail and groupsWriteGen. Both are per JS context; the gen re-read only covers reads in flight, not read-modify-write callers; the empty-DB branch writes during a read.
metadata:
  type: project
---

Constraints of `groupsWriteTail` and `groupsWriteGen` in localDb.ts, as of 2026-09-13:

- **Per JS context only.** The popup and the service worker each have their own tail and gen. IDB serializes transactions, not read-modify-write sequences.
- **Guarantee.** A read never sees state older than a write issued before the read ended (the gen is bumped synchronously at issue time), up to `MAX_READ_ATTEMPTS` (5) re-reads.
  - It does NOT make read-modify-write atomic. A caller with a macrotask gap (network, chrome API calls) between its read and its write can overwrite a concurrent write, so keep new writers' read→write gaps microtask-only.
  - Callers with only microtask gaps are safe: `useGroupsMutation`, the realtime handler, the `savedAt` migration.
- **Cache vs IDB convergence.** The cache and IDB converge only if every writer sets the cache in the same synchronous tick it issues the write. The DnD drop does; follow that shape for new writers rather than "`await save`, then `setQueryData`".
- **Ordering.** The DnD revert fix depends on `saveGroupsState(next)` being issued synchronously before `setGroupsNow`, with no `await` before it. The sensor's `flushSync` only renders after that synchronous part.
- **Reentrancy.**
  - A queued step must use a raw reader. Calling `getGroupsState` from inside the chain deadlocks.
  - The empty-DB branch calls `saveGroupsState` from inside a read. That bumps the gen, so the creator always re-reads once (harmless). It would deadlock if reads were moved into the queue.
- **Tests with fake-indexeddb don't reproduce real IDB transaction scheduling closely.** Reason about tx creation order, not test outcomes.

**Why:** each of these is easy to break or misread while "improving" the queue.
**How to apply:** check all of these whenever localDb's write path, `onDragEnd` commit ordering, or any `setQueryData(GROUPS_QUERY_KEY)` caller changes. Related: [[learnings-dnd-rebase-identity]].
