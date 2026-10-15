---
name: auto-backup-tests
description: Test layout and mock gotchas for the automatic-backup / sessions-sync code (localDb commit mocks, abortSignal chains, flag sentinels, mid-request interleavings)
metadata:
  type: reference
---

- **Every Supabase request in the product ends in `.abortSignal(...)`**: hand-written chain mocks need that last link (a thenable with `abortSignal`, or an object whose `abortSignal` is the async terminal). `fakeSupabase.ts` `upsert` returns the same thenable `request()` as the other verbs.
- **The localDb factory mock must mirror the transactional API**: `commitSessions`, `commitSessionsIfGuardHolds` (guard check, then `settings` / `updateSettings` functions applied to the stored value / `markUploaded`), `compareAndSetSetting` (strict equality, written only on a match), `markSessionUploaded`. A shared `applyChanges()` helper in the test file keeps unit mocks and the real semantics aligned; when the source gains a new localDb call, every file mocking localDb fails with "No X export is defined on the mock".
- **Settings flag values are falsy but distinct**: `SESSIONS_MIGRATION_DONE_KEY` can be `true`, `false`, `0` (a pass is running) or `''` (a backup run's marker). Assert with `toBe`, not `toBeFalsy`, where the distinction is the point; use `toBeFalsy` only for "still not done".
- **Interleavings are tested by a hook inside the faked request** (`net.onSelect`, `net.onUpsert` in `autoBackup.integration.test.ts`; `h.afterGetSessions` in the download unit test): run the other writer (a local delete, a wipe) at that point, then assert the end state.
- **Mid-pass wipe vs mid-pass delete** (sessions pass in `useSync`): the cleanup delete only runs while the pass's own marker is still stored, so a wipe (which removes the flag with the sessions) must produce no server delete; test both in the integration file.
- **Bulk edits of test files from the shell**: a long heredoc with quotes can break the Bash tool ("unexpected EOF"); write the script or the appended text with the Write tool into the scratchpad and run it with `python -X utf8`. Several test files are CRLF: replace on `\r\n`-normalised text and write back with `newline=''`.
- **Node vs Git Bash paths**: `/tmp` in Bash is not `C:\tmp` for node; use `$TEMP` / the scratchpad path.
- **ESLint ignores `__tests__`** in the extension package; `tsc --noEmit` is the check that covers test files.
- Components that mock `@/lib/localDb` wholesale break on `setSetting` use inside `uiStore`: spread `importActual` and override only `getSetting`/`setSetting`.
