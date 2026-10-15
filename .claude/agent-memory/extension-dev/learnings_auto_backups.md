---
name: auto-backups
description: Automatic backups (Pro) are sessions marked auto, taken by the worker on a chrome.alarms alarm; alarm re-arm, due-check, fingerprint and test-stub gotchas
metadata:
  type: reference
---

Automatic backups = a `Session` with `auto: true`, written by the background worker
(`lib/autoBackup.ts` decides and writes, `lib/autoBackupAlarm.ts` owns the alarm and messages,
constants in `packages/shared/src/constants/autoBackup.ts`). No schema change: `auto` goes inside
the encrypted `{name, groups, description}` blob in `sessions.groups`.

Non-obvious things:

- **Never re-create a periodic alarm that already has the right period.** `chrome.alarms.create`
  with the same name restarts the countdown, and the arming code runs on every worker start (an
  MV3 worker restarts many times an hour), so a daily or weekly alarm would never fire. Compare
  `existing.periodInMinutes` first.
- **The alarm is a trigger, the stored timestamp is the decision.** A periodic alarm fires a few
  seconds short of "one interval since the last backup stamp", so the due check needs a
  tolerance (`AUTO_BACKUP_DUE_TOLERANCE_MS`); without it an hourly alarm backs up every 2 hours.
- **A worker-start due check needs a throttle.** The run can end in a network request (the
  subscription check), and for an account that will never get a backup (free, signed in) it
  would repeat on every worker start. `STARTUP_CHECK_MIN_GAP_MS` limits it.
- **Order checks local-first, network-last**: settings, session, store owner, due, empty,
  fingerprint, then the subscription fetch. A failed fetch is "unknown", not "free" and not
  "paid" (`fetchTier` returns `null`).
- **"Unchanged" must also check the last backup still exists** (`lastBackupId` in the stored
  state), otherwise deleting every backup stops new ones until the groups change.
- **Listener order in `background.ts` is asserted by tests** (`stub.listeners.onAlarm[0]`,
  `onMessage[0..2]`, `onStartup[0]` in `background.test.ts`). Register new listeners AFTER the
  existing ones, or those indexes shift and unrelated tests fail.
- **A `.ts` extension on a VALUE import inside `packages/shared` breaks the web type-check**
  (TS5097); the existing `'../types/index.ts'` import only passes because it is type-only.
- **Settings is draft-then-save and saves the whole object.** A control that saves immediately
  (Data tab has no footer) must also patch the modal's draft, or a later "Save changes" writes the
  old value back.
- **Automatic backups must not count toward the Free session limit** (a downgraded account keeps
  them): count `sessions.filter(s => s.auto !== true)`.
- Restoring a backup is NOT `useRestoreSession` (that closes every window). It runs the stored
  groups through `importGroups(JSON.stringify(...))` + `useImportGroups`, which validates, gives
  fresh ids via `asNewGroup` and is undoable.
- The extension never pulls MANUAL sessions from the server: that store is device-local with an
  upload-only cloud copy (the web dashboard reads it). Automatic backups are the exception:
  `lib/autoBackupDownload.ts` reads the user's own `sessions` rows when Settings → Data is shown,
  decrypts, keeps `auto === true`, sanitises through `importGroups`, and only ADDS missing ones.
- The server cannot tell a backup from a manual session (the marker is inside the ciphertext), so
  the download must decrypt every row it reads and is bounded by a row limit; server-side counts
  of sessions can never exclude backups.
- "Deleted here" must be remembered apart from "last backup" state: a device with only downloaded
  backups has no backup state, so pending remote deletes live under their own setting key, and the
  download skips those ids (otherwise a failed remote delete resurrects the backup).
- Automatic backups are filtered out of the sidebar Sessions list (its Restore closes every
  window); they are managed in Settings → Data only.
- **A query keyed by the signed-in user runs twice on mount** (key `null` while `useAuth` loads,
  then the user id). A side effect done by the first run (rows added to IndexedDB) is invisible
  if the UI only reacts to the rendered query's data: gate the query on `!authLoading` and do
  the cache invalidation inside the `queryFn`. Unit tests did not catch this; the real popup did.
- **Acting for a captured user id**: `supabase.auth.getSession()` is re-read by every helper, and
  the session can change mid-run (web bridge `SYNC_AUTH`, sign-out). Uploads and deletes take an
  `expectedUserId`, check it before and after the key lookup, and write `user_id: expectedUserId`
  so RLS rejects a raced request. A signed-out client gets "zero rows" with no error: never read
  that as "deleted".
- **Guarded local commits instead of a lock**: `commitSessionsIfGuardHolds` writes sessions and
  settings in one IndexedDB transaction only if an account-scoped setting still holds the
  expected value. The account wipe deletes account-scoped settings in its own transaction, so a
  writer that started before a wipe finds the guard gone. No lock ordering to reason about.
- **Sender id is not proof of an extension page**: a content script's messages carry the
  extension id too. Require a `sender.url` under `chrome.runtime.getURL('')`, with or without a
  tab (`lib/messageSender.ts`); "no tab" alone is not accepted. Unit tests that build a sender
  by hand must give it a `url`. Never spread a page-supplied payload into a runtime message next
  to an allow-listed `type`.
- **Decision: absence on the server never deletes a local backup.** `uploadedAt` means one
  thing, "never INSERT this row again". The download only adds; the sessions re-upload pass
  treats a backup the server no longer has as done. Deleting in the web dashboard therefore
  removes the cloud copy only, and every piece of copy says so.
- **A list several contexts append to is updated inside the transaction, not read then
  written**: `commitSessionsIfGuardHolds` / `commitSessions` take `updateSettings`, functions
  applied to the value stored when the transaction runs. After a request, take off only the ids
  that were SENT, never write `[]`.
- **A boolean "work left" flag that several contexts re-arm needs a third value while a pass
  runs** (`SESSIONS_HEAL_IN_PROGRESS`, falsy): the pass ends with a compare-and-set to `true`,
  so a re-arm written during the pass survives.
- **A writer that re-arms that flag for ONE item it will finish itself uses its own falsy
  value** (`REARMED_BY_BACKUP`, written only over `true`) and compare-and-sets it back to `true`
  when the item is done. Readers test truthiness only, never `=== false`.
- **Two reads around a request see a single-transaction delete only in one order**: read the
  items first and the "deleted here" list second. Then a delete lands before the item read (its
  id is in the list) or after it (the item is still in the read).
- **"No longer stored" is also what a wipe looks like.** Cleanup that deletes server rows for
  items missing locally must first check a marker the wipe removes in the same transaction.
- **The newest item is not part of its own retention selection**: prune the EXISTING backups
  down to `keep - 1`. Sorting the new one in by date deletes it when the clock moved back.
- **Claim the store only under the backup lock.** A claim made outside it can restore the
  guard a wipe removed while an older run is still going.
- **A stamp on a stored row is written by re-reading the row in the same transaction**
  (`markSessionUploaded`), never by saving back a copy read before a request.
- **`TM_E2E_GRANT_DOWNLOADS=1` builds into the normal dev output folder.** Copy the folder
  aside and rebuild without the switch, or every other spec runs with the changed manifest.
- Measured in a headless development build with the permission granted: base64 `data:` URL
  downloads of 1, 4, 20 and 61 MB from the service worker all complete with the exact size.
- Adding `.abortSignal(...)` to a Supabase call breaks every hand-written chain mock for it
  (`... .abortSignal is not a function`); the fakes need the extra link.
- **Validating a string with `in` against an object literal lets `toString`/`constructor`
  through**: use an explicit `as const` array.
- **`chrome.downloads` from the worker**: a service worker has no `URL.createObjectURL`; a
  base64 `data:` URL works (measured up to 60 MB in Chromium). Firefox does not accept `data:`
  URLs for downloads but its background page has `createObjectURL`, so branch on that.
  `downloads` works as an optional permission; request it as the first call in the click.
- **A headless browser cannot answer `chrome.permissions.request`**: the end-to-end check uses a
  development-only build switch (`TM_E2E_GRANT_DOWNLOADS=1`) that lists the permission as
  required. Playwright stores extension downloads under GUID names in `downloadsPath`; read the
  intended name from the extension's own status, the content from that folder.
- **Extension pages forbid `new Function`/eval (CSP)**: Playwright `evaluate` helpers that build
  functions from strings fail there; pass an operation name and switch inside one function.
- **A permission added to `optional_permissions` still changes the CI baseline**
  (`packages/extension/manifest-permissions.json`, checked by
  `scripts/ci/check-manifest-permissions.mjs`): update both in the same change.
- **Saving any setting re-checks "is a backup due"**, so turning an option on can create the
  first backup before the user presses "Back up now". Tests of the manual path must account for it.
- The encryption passphrase rejects spaces; its setup form submits by button, not Enter.
- A component module that a test stubs with `vi.mock` must not also be the home of a constant
  another file imports: keep shared query keys in a dependency-free lib module.
- Editing files with a `node -e "..."` script inside a bash double-quoted string: backticks are
  command substitution. Use the Edit tool or a quoted heredoc for anything containing backticks.
