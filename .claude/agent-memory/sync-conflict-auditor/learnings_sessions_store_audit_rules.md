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

Related: [[sync-server-stamp-and-merge-shape]], [[learnings-groups-write-queue-constraints]].
