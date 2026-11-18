---
name: learnings-session-upload-keys-and-passes
description: Session uploads - uploadedKey (key fingerprint) for re-insert after a reset and pass resume, per-pass random token, deleted-ids in the delete transaction, access-token check around the refresh read, backups use pending marks
metadata:
  type: reference
---

How saved sessions and automatic backups reach the server (lib/sessionUpload.ts, hooks/useSync.ts,
lib/autoBackup.ts), and the non-obvious rules behind it.

- **`Session.uploadedKey`** is the fingerprint (`salt.wrap_iv` of the `encryption_keys` row,
  `getDataKeyFingerprint`) of the key the server copy was written under. It is returned by the
  upload gate (`getContentUploadKey(userId)` → `{ key, keyFingerprint }`; a failed fingerprint
  lookup must never turn the gate into `locked`) and stamped by `markSessionUploaded` /
  `SessionChanges.markUploaded`. Two uses:
  - `refreshSessionRow`: row missing + a SAVED session whose `uploadedKey` differs from the current
    key → re-insert (`reinserted`). After a reset elsewhere the dashboard shows the old-key rows as
    unreadable, and deleting them must not make a device with the readable copy answer `gone`
    forever. Unknown keys (no stamp, no fingerprint) and backups keep the update-only rule.
  - The full pass skips sessions already under the current key with nothing pending, so a pass that
    hit its deadline resumes instead of restarting.
- **`Session.remoteGone`**: set when this device itself got `gone` for the row (cleared by a later
  write that finds it). Without it, the stale `uploadedKey` left after a dashboard delete made the
  NEXT key change look like "old-key row cleared" and re-inserted the deleted session. The full
  pass counts it as done. Unavoidable trade-off (in a code comment): a dashboard delete made before a
  reset that this device never observed is indistinguishable and is re-inserted.
- **Only a VERIFIED binding gives a fingerprint** (`getDataKeyFingerprint`): a legacy key that merely
  adopted the current row may be stale, and the resume skip must not trust copies written with it.
- **Backups are user deletes too**: `deleteAutoBackup` (noteSessionDeletedHere + the remembered id in
  its transaction) and rotation (the stale ids, in the backup's own transaction) use
  `addDeletedSessionIds` as an `updateSettings` entry. Downloaded backups are stamped with the key
  they were decrypted with.
- **A backup run never clobbers a running pass's token**: `rearmSessionsFlagForBackup` leaves
  `pass:...` alone (the backup's pending mark covers its retry).
- **The changed-sessions pass is bounded like the full one**: `cycleDeadline()`, and it stops at the
  first `failed` (a failure that would hit every row: offline, timeout, auth, RLS, locked key). A
  `rejected` row (`isRowRejection`: HTTP 413 or Postgres `22…`/`23…`/`54…`, read from the PostgREST
  answer's `error.code` and `status`) is skipped, so one oversized session never blocks the rest;
  the retry delay still applies afterwards.
- **`remoteGone` only when the key was known at the read**: `refreshSessionRow` returns the
  fingerprint with `gone` only if it had one; without it the stamp is `'keep'` (no marker added, an
  earlier one kept). Otherwise an unverified device made a possibly-unreadable-row delete permanent.
- **A failed re-delete after an upload goes into the backups' pending remote deletes**
  (`deleteRowIfDeletedHere`), and the backup download also skips ids in `SESSIONS_DELETED_HERE_KEY`:
  a row that survived on the server is never brought back as a backup.
- **The full-pass flag is "due unless `=== true`"**. A running pass stores its own random token
  (`pass:<nanoid>`); the end-of-pass compare-and-set and the orphan cleanup (remote deletes) act
  only while THAT token is still stored. A shared constant marker let popup B's pass (after "Clear
  all data" in A) be read by A as its own, and A deleted pushed ids remotely.
- **Only key changes arm a full pass** (setup, reset, unlock with `repush`). Saves and colour
  changes use `uploadPending`; a backup is committed WITH `uploadPending` and a failed upload just
  compare-and-sets the run's `REARMED_BY_BACKUP` back to `true`. The changed-sessions pass takes
  `uploadPending` sessions plus SAVED sessions with no `uploadedAt` (saved while `cloudSync` was
  false: entitlements loading, offline, lapsed).
- **User deletes are remembered in IndexedDB** (`SESSIONS_DELETED_HERE_KEY`, `{ id: at }`, 1 h
  TTL, 500 max, account-scoped) in the SAME transaction as the local delete, so an upload in
  another popup that re-created the row deletes it again (`deleteRowIfDeletedHere`). Wipes record
  nothing, so they never delete account data.
- **`gone` needs one sign-in for the whole read**: compare the access token before and after the
  SELECT (`signedInToken`), not just the user id. A sign-out/sign-in as the same user in between
  reads "no row" as anon (RLS).
- Tests: `useSync.test.ts` emulates the real `uploadStoredSession` over its push/refresh/mark mocks
  (both passes upload through it) and its `flag(start, OWN)` helper answers the pass's own token.
  The integration test `sessionSyncFixes.integration.test.ts` uses an inline Map-backed `sessions`
  table instead of `fakeSupabase.ts` (which is groups-oriented).

Related: [[learnings-encryption-key-tristate]], [[learnings-auto-backups]].
