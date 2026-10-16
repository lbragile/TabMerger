---
name: learnings-write-path-server-base
description: Which groups write path keeps the stored server base (remoteUpdatedAt) and which one trusts the incoming state; check this whenever a writer moves between saveGroupsState and updateGroupsState
metadata:
  type: reference
---

`writeGroupsState(state, expectedRev, preserveBases, cause)` in localDb.ts decides where each group's
server base (`remoteUpdatedAt`, the compare-and-swap key of the push) comes from:

- `saveGroupsState` passes `preserveBases = true`: the STORED base wins, so a cache- or snapshot-derived
  state cannot roll the base back.
- `updateGroupsState` passes `false`: the INCOMING base wins, on the assumption that `fn` built its
  result from the fresh `current` it was given.

So any writer that moves from `saveGroupsState` to `updateGroupsState` while still copying groups out
of an older state (an undo snapshot, a cache value, an import file) must take each base from
`current`, not from the old copy. If it doesn't, a group pushed since that old state goes back to its
old base. The next push then fails its compare-and-swap, and the merge produces a "(conflict copy)"
(pending group) or adopts the remote row and reports a foreign change (clean group), which clears
the undo history.

Also on this subject:
- `positionDirty: false` on an incoming group is a claim that the group is already at that index on
  the server, and it wins for that one write. Stored groups never carry `false`, so a copy taken from
  stored state only ever carries `true` or nothing.
- Hooks that run after a write (`afterWrite`) get the base the WRITER supplies. `saveGroupsState`
  callers supply their cache state, and only `expectedRev` ties that state to what is stored.

**How to apply:** when a diff changes which write function a writer calls, or adds a writer that
spreads groups from a non-fresh source, trace `remoteUpdatedAt` from the source to IDB to the next
push. Related: [[learnings-sync-server-stamp-and-merge-shape]], [[learnings-groups-write-queue-constraints]].
