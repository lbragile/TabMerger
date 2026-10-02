---
name: groups-position-now-open
description: Server code must never infer Now Open from groups.position — Now Open is never synced and legacy rows all sit at the default position 0
metadata:
  type: reference
---

Now Open (the permanent group) is device-local: the extension never pushes it, so **no `groups` row is ever Now Open**. `groups.position` defaults to 0, and rows written before the extension started pushing `position` all hold that 0, so `position === 0` matches ordinary saved groups.

Rules the organize workflow (`lib/workflows/tabOrganizer.ts`) follows:
- DB-loaded rows are always `permanent: false`. Order by `position`, then `updated_at desc`, then `id`, because legacy rows tie.
- Only the client payload (`groupsState.available`, which includes Now Open at index 0, with `permanent` sent explicitly) can mark a group permanent. The workflow passes those ids to `applyChanges` as `pinnedIds`.
- `applyChanges` skips any action naming a pinned id or an id with no stored row, so a no-op write is never counted as applied.
- `reorder` follows the extension's push rule, position = index in the client list: pinned ids take no slot, every other id takes the next slot starting at 1 (an unsynced id keeps its slot but isn't written), and 0 is never written.

**How to apply:** any new server route that needs "which group is Now Open" must take it from the client body, not from `position`.

Related: [[organize-e2ee-writeback]]
