# Sync Conflict Auditor Memory

- [TanStack cancel vs joined fetchQuery](learnings_tanstack_cancel_joined_fetch.md) — cancelQueries AND default invalidateQueries (cancelRefetch:true) reject joined fetchQuery callers
- [groupsWriteTail/Gen constraints](learnings_groups_write_queue_constraints.md) — per-context, gen covers in-flight reads not read-modify-write, raw reader inside the chain, synchronous write-before-cache ordering for the DnD commit
- [DnD rebase identity pitfalls](learnings_dnd_rebase_identity.md) — rank + duplicate-only context check; structurally blind to a pure transposition of identity-equal items
