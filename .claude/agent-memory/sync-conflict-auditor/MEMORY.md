# Sync Conflict Auditor Memory

- [TanStack cancel vs joined fetchQuery](learnings_tanstack_cancel_joined_fetch.md) — cancelQueries AND default invalidateQueries (cancelRefetch:true) reject joined fetchQuery callers
- [groupsWriteTail/Gen constraints](learnings_groups_write_queue_constraints.md) — per-context, gen covers in-flight reads not read-modify-write, raw reader inside the chain, synchronous write-before-cache ordering for the DnD commit
- [Server-stamped updated_at + merge shape](learnings_sync_server_stamp_and_merge_shape.md) — server stamp vs client clock, compare-and-swap pushes, cycle shape, keyset paging on a global text id, per-request timeouts, request identity
- [IDB explicit commit + un-awaited reads](learnings_idb_explicit_commit.md) — commit() stays atomic, sync put throws never abort, creation-order guarantees, fake-indexeddb models call order only
- [DnD rebase identity pitfalls](learnings_dnd_rebase_identity.md) — rank + duplicate-only context check; structurally blind to a pure transposition of identity-equal items
