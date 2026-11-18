---
name: learnings-sessions-store-audit-rules
description: Rules for auditing anything that writes the IndexedDB sessions store or the Supabase sessions table (saved sessions, automatic backups) - RLS shape per verb, silent zero-row writes, what a settings-key guard can and cannot prove, and which writers sit outside the backup lock
metadata:
  type: reference
---

Facts and rules to check a sessions / automatic-backup change against. Re-verify against the migrations and code before citing.

- **RLS on `sessions` differs per verb.** SELECT and DELETE are own-rows only (`auth.uid() = user_id`); INSERT and UPDATE also need `has_cloud_sync()`. So an account without cloud sync can still read and delete its rows, an upsert is refused with an error, and a plain UPDATE that RLS filters out returns success with zero rows. A caller that needs to know a row was written must ask for the row back (`.select()`), not test `error`.
- **A request with no session is sent with the anon key** and is answered with zero rows, not an error. An identity check before and after a request proves who was signed in at those two moments, not whose token the request carried. Positive proof is a non-empty own-rows answer, or a request that carries an explicit token.
- **Sessions have no pull path and no per-row pending flag.** One account-scoped flag re-arms a re-upload of every local session. Anything that re-arms it more often multiplies whatever that loop does, and the loop runs before the groups cycle in the popup, so its requests delay group sync.
- **A guard key in the settings store detects a wipe only if** (a) the wipe removes that key inside the same transaction that clears the stores, with the key list not read beforehand in another transaction, and (b) every read the guarded write depends on happens after the claim was written. A guard whose value is a user id is satisfied again by any later claim for the same user, so it identifies an account, not a run.
- **Check which writers hold the backup lock.** Read-modify-write of a settings list (ids pending a remote delete) is only safe between lock holders; a caller outside the lock, or a `saveSession({...staleCopy})` after a network await, can drop or re-create entries.
- **Order of local delete, remote delete and upload matters within one run.** A remote delete flushed before the upload of a row the same transaction already pruned locally leaves a server row nobody tracks.
- **Rotation and "newest N" use the client `createdAt`.** A clock that moved back makes a new item sort as the oldest.
- **Group writes that drop groups record remote deletes only while the cloud-sync-active setting is true.** A bulk replace has no second path, so check what value that setting has when the entitlement lookup has not succeeded.
- **A filter list must be read after the rows it filters against.** An "add what is missing locally" step that skips ids pending a delete has to read the local rows FIRST and the pending list SECOND (or both in one transaction), and both after the network request. Then a delete that is one transaction (row removal + pending id) is seen by at least one of the two reads, whatever the interleaving.
- **An in-progress marker that is one shared constant does not identify a pass.** Compare-and-set against it tells "nothing re-armed since some pass started", not "since MY pass started". Check how many contexts can run the pass at once; a per-pass token closes it.
- **A deadline-bounded pass over a list with no per-row "done" stamp restarts from the top.** Check the order: items already on the server sent first can use up the whole budget on every attempt, so the tail is never reached and the completion flag is never set.
- **A retry delay kept in a React ref lasts one popup lifetime.** Opening the popup again resets it, so "not before N minutes" is really "at every popup open".
- **The groups merge skips every id in the pending-delete set, local copy included.** So a remote delete may only be requested for groups whose local removal is certain: a side effect fired from inside a mutator runs before the write is known to have committed.
- **An "update-only once confirmed" stamp turns server absence into a tombstone.** Check every event that can make the server copy unreadable or invite its deletion (a key reset: the dashboard lists old-key rows as unreadable with Delete). A stamp that does not record which key the row was confirmed under cannot tell "user deleted it" from "user cleared unreadable rows".
- **A per-row change token only covers writes made while the gate that sets it was open.** A row written while the gate was closed (entitlement unknown or offline reads as free, signed out) carries neither the token nor the confirmed stamp. Check what uploads it once the gate opens; "no confirmed stamp" can serve as the marker itself.
- **In-memory per-id queues and "deleted here" sets cover one JS context.** `popup.html` can also be open as a tab, so count the contexts that can run the same pass, and check the cross-context interleavings separately.
- **A per-key "confirmed" stamp needs a third state for "absent".** If an observed server absence keeps the stamp's key, the next key change makes it look like an old-key copy again. Check what is written on the "gone" outcome, not only on success.
- **A key fingerprint taken from an unverified binding does not prove which key encrypted the row.** A skip or resume rule built on such stamps can skip exactly the copies a stale-key repush must rewrite.
- **A "deleted here" record only works if every local delete path writes it.** Backups are deleted by different writers (user delete, rotation) than saved sessions; check each one when an upload path starts covering backups.
- **"Exists?" (SELECT) then UPDATE costs two requests per row.** Recount the pass budget when a path changes from upsert to read-then-update.
- **A permanent "gone" tombstone is only as good as the observation behind it.** Check that it is written only when the caller could tell "deleted" from "old-key copy cleared" at that moment (current key fingerprint known), not on every absent row.
- **"Stop at the first failure" over a list read in a fixed order** is right for failures that hit every row (offline, locked key), but one row that always fails (too large, rejected) then blocks every row after it on every attempt. Check whether the order rotates or the failed row moves to the back.

Related: [[sync-server-stamp-and-merge-shape]], [[learnings-groups-write-queue-constraints]].
