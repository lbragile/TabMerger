---
name: learnings-local-vs-pulled-group-shape
description: A group created locally and the same group decoded from a pull are NOT structurally equal; any raw content comparison across that boundary must normalize first
metadata:
  type: reference
---

The same group has two stored shapes depending on where this device got it:

- Created on this device (`createGroup` in lib/utils.ts): `permanent: false`, no `starred`, no `archived`.
- Decoded from a row (`rowToGroup` in lib/syncEngine.ts): no `permanent`, `starred: false`, `archived: false`
  always set, `note` undefined when absent.

The creator device keeps its local shape until it ADOPTS a remote copy (merge "clean, stamp newer" branch,
or the realtime UPDATE handler), which only happens after another device re-pushed the row. Re-pushes with
unchanged content do happen: `markAllGroupsPendingSync` (encryption setup, stale-key recovery), DnD `bump`,
bulk actions that re-stamp without a real change.

`groupContentEqual` (lib/syncConflict.ts) normalizes `starred`/`archived`/`note`/`info` and is safe.
A comparison built on a plain "strip bookkeeping and stringify" key (savedData `contentKey`, any new
per-feature key) is NOT safe across this boundary: it reads a pure re-push as a content change.

**How to apply:** when a diff adds logic in `writeGroupsState` (or any write hook) that compares the stored
group with the incoming one, check what happens when the incoming one is a pulled copy of a locally
created group. Either normalize like `groupContentEqual`, or only act when `next.pendingSync === true`
(every local edit sets it; an adopted remote copy has `pendingSync: false`).
Related: [[learnings-write-path-server-base]], [[sync-server-stamp-and-merge-shape]].
