---
name: learnings-idb-version-bump-and-undo-windows
description: IndexedDB version bumps in localDb (blocking handler, connection memo, downgrade), settings-store tx overlap, and why a toast duration is not an undo-window guarantee
metadata:
  type: reference
---

**IndexedDB version bumps (`localDb.getDb`)**
- An extension update or reload destroys every old context (popup, pages, worker), so an old
  connection without a `versionchange` handler can't actually block a new upgrade in practice. The
  `blocking` handler matters for the next bump, and only if it closes the connection that GOT the
  event. `getDb` stores the resolved db (`dbInstance = await openDB(...)`), not the promise, so
  concurrent first calls open several connections. A handler that closes `dbInstance` closes
  whichever one was stored last; the others stay open and keep the next upgrade blocked. Memoize
  the open promise and close the event's own connection.
- After `blocking` closes the connection, any code still holding the old `db` across an await
  throws InvalidStateError on its next `db.transaction`.
- DB_VERSION can never go down. Code with a lower version opening a higher-version DB gets
  VersionError on every `getDb`, which makes every store unreadable. Reverting a version bump after
  release has this effect, so check for it whenever a revert is proposed.
- fake-indexeddb upgrade tests usually close the v1 handle first. They don't exercise the
  blocked/blocking path.

**Transaction scope overlap**
- `updateGroupsState`, `saveGroupsState`, session writes and the clears all include `settings` in
  their readwrite scope. Any new writer that opens a readwrite tx on `[ownStore, 'settings']` (to
  re-read a setting atomically) is serialized against group writes. Nothing is lost, but its tx is
  not "its own store only". To check this, list every `db.transaction([...])` and intersect the
  scopes.

**Undo windows backed by a delayed delete**
- Sonner (v2) pauses a toast's timer while the toaster is hovered or the page is hidden. "Toast
  duration = delete delay - 1 s" therefore does not guarantee that Undo is never offered after the
  delete. The delete needs real slack, or the undo has to check what it restored and say so.

Related: [[learnings-idb-explicit-commit]], [[learnings-groups-write-queue-constraints]]
