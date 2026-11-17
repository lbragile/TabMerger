---
name: learnings-edit-uploads-and-noop-mutators
description: Rules for auditing an edit of an existing session that uploads again (upsert vs a concurrent delete, out-of-order uploads, re-arm after popup close), and group mutators that can resolve as a silent no-op under align:false
metadata:
  type: reference
---

- **Re-uploading an existing session is a different case from saving a new one.** A new id cannot
  race a delete. An edit can: the user deletes while the upsert is in flight, the remote delete lands
  first, and the upsert re-creates a row that nothing local tracks (sessions have no pull path). The
  self-heal pass handles this by re-reading local ids after its upserts and deleting the orphans.
  Every edit-then-upload path needs the same step, or a per-id serialized chain that always uploads
  the stored copy.
- **Concurrent upserts of one session are not ordered.** Two quick edits can leave the server holding
  the older one. When both succeed, the flag is set and no later pass fixes it.
- **The re-arm-on-failure pattern (`uploadSessionOrRearm`) never runs if the popup dies mid-upload.**
  So an edit's server copy can stay stale with no retry scheduled.
- **`useGroupsMutation` with `align:false` never sets `gone`.** A mutator that returns null because
  its target (by id) disappeared resolves exactly like a success. Any caller that toasts "Saved"
  must find out about the no-op itself, for example with a flag set inside the mutator.
- **A hook-level UI filter is not a data-layer guard.** Check whether a lib writer (e.g. a session
  edit) would accept the excluded kind (automatic backups, tour groups) if it were called directly.

Related: [[learnings-sessions-store-audit-rules]], [[learnings-groups-write-queue-constraints]].
