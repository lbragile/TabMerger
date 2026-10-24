---
name: groups-position-now-open
description: Server code must never infer Now Open from groups.position — Now Open is never synced and legacy rows all sit at the default position 0
metadata:
  type: reference
---

Now Open (the permanent group) is device-local: the extension never pushes it, so **no `groups` row is ever Now Open**. `groups.position` defaults to 0, and rows written before the extension started pushing `position` all hold that 0, so `position === 0` matches ordinary saved groups.

Rules organize follows (`lib/ai-organize.ts`, `sanitizeOrganizeProposal` in `lib/ai.ts`):
- DB-loaded rows are always `permanent: false`. Order by `position`, then `updated_at desc`, then `id`, because legacy rows tie.
- Only the client payload (`groupsState.available`, which includes Now Open at index 0, with `permanent` sent explicitly) can mark a group permanent; a missing flag means "first in the array". The sanitizer drops any merge / rename / delete naming a permanent id.
- Positions are the extension's business: it applies the proposal (including `reorder`) locally and pushes `position` = index in its list, Now Open at 0 never stored, synced groups from 1.

**How to apply:** any new server route that needs "which group is Now Open" must take it from the client body, not from `position`.

Related: [[organize-e2ee-writeback]]
