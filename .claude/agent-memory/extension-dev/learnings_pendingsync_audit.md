---
name: pendingsync-audit
description: Audit of every useGroups.ts/useCurrentTabs.ts/useDnd.ts mutation for correctly setting pendingSync:true — found and fixed one real gap (useUpdateGroupInfo)
metadata:
  type: learnings
---

Audited every mutation in useGroups.ts, useCurrentTabs.ts, and useDnd.ts against the
"every group-mutating write must set pendingSync:true (except Now Open)" invariant.

**Real bug found and fixed:** `useUpdateGroupInfo` (useGroups.ts, ~line 191) updated only
the `info` field and never set `pendingSync`/`updatedAt`. It's currently unreachable from
the UI (only called in tests as of 2026-08), but it's an exported hook other components
could wire up later, so it's a latent silent-sync-miss. Fixed to set
`pendingSync: true, updatedAt: Date.now()` unless the group is `permanent`.

**Everything else already correct.** Every other mutation (add/delete/duplicate group,
color/name/note, reorder, add/delete window, window name/note/star/incognito, delete tab,
tab note, replace/merge with current, unite/split windows, sort tabs, move tab, move window,
archive/restore, reminders, dedupe, stale-tab cleanup, import) explicitly sets
`pendingSync: true` on every group object it writes, correctly guards Now Open (`permanent`)
either by construction (syncNowOpen always sets `pendingSync: false`) or explicit checks.
`useDnd.ts`'s two handlers (group reorder, window reorder/cross-group move) also set it
correctly on every touched group.

**`pushPendingChanges` in syncEngine.ts is correct** — reads all groups from IDB, filters
`pendingSync === true`, then belt-and-suspenders excludes `permanent`. No nested-field
filtering bug; each Group is one flat pendingSync flag, no per-window/per-tab granularity.

**Turns out the real "sync doesn't sync everything" fix already existed**: there's a
`forceFullResync(session, localGroups)` in syncEngine.ts (drift-recovery fallback — pushes
ALL non-permanent local groups regardless of pendingSync, then pulls) wired to a "Force full
resync" button in Settings.tsx's Account tab (only visible when `cloudSync` entitlement is
true). This is the mechanism for "sync entire extension state," distinct from the normal
incremental per-mutation push. If a user reports full-state drift, point them at this button
before assuming a missing-pendingSync bug — check that first, it's cheaper than a full audit.

**Test-suite gotcha:** `Settings.test.tsx`'s "force full resync" test can fail when run as
part of the full `vitest run` suite but pass in isolation — cross-test-file pollution
(jsdom `navigation to another Document` warning suggests router/navigation state leaking).
Not related to pendingSync logic; re-run the single file to confirm before treating a
full-suite failure as a real regression.
