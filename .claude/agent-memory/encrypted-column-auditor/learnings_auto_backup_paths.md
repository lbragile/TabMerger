---
name: auto-backup-paths
description: Where automatic backups touch the encrypted sessions table and the local file copy, and what to check in each
metadata:
  type: reference
---

Automatic backups are ordinary `sessions` rows. The only marker is `auto: true` inside the `groups` ciphertext; the `name`/`description` columns are written blank. So the server cannot tell a backup from a saved session, and any route that needs to will not work.

Paths to check when backups change:

- **Upload:** `packages/extension/src/lib/sessionUpload.ts` (`pushSessionToSupabase`, `refreshUploadedSession`) is the one writer for manual sessions, the sync self-heal and backups. There is no plaintext branch: no key means nothing is sent. Any new writer of `sessions` that skips this module is a finding.
- **Extension download:** `lib/autoBackupDownload.ts` reads `id, groups, created_at` and decrypts on the client, skipping rows where `isEncryptedBlob` is false. Client reads with the key are fine; only check the guard.
- **Web dashboard:** the rows are decrypted in `SavedSessionsProvider` (see [[server-page-to-client-provider]]). The delete route takes only an id, with no `.select()`.
- **File copy:** `lib/autoBackupFile.ts` writes with `chrome.downloads.download` from a `data:`/blob URL, so it stays local. Its bookkeeping keys (`autoBackupFileStatus`, `autoBackupFileLast`) are local settings, and the extension has no settings table on the server. To confirm, list every `.from('<table>')` in `packages/extension/src`.
