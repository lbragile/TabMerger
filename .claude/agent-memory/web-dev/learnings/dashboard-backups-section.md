---
name: dashboard-backups-section
description: How the dashboard splits `sessions` rows into Saved Sessions and Backups after decrypting, the rules for rows of unknown kind, validating decrypted content, Radix dialog focus without a trigger, and how to look at encrypted paid states locally
metadata:
  type: reference
---

# Dashboard: Saved Sessions vs Backups

Automatic backups are rows of `sessions`. The only marker is `auto === true` inside the ciphertext, so no server query or count can tell them from saved sessions.

## Structure
- `SavedSessionsProvider` (wraps the dashboard page) decrypts the rows once; `SessionList`, `BackupsSection` and the sessions stat (`SessionsStat`) read its context. `SessionList` still accepts `sessions` and wraps itself in the provider when rendered alone.
- `lib/savedSessions.ts` holds the pure parts: `toSavedItem` (validation), `splitSavedItems`, counts, time formatting, the download file content and name.
- A server-rendered card can show a browser-only number by taking client components as its value and description (`StatsOverview`'s `sessionStat`).

## Rules
- Decision: a row that will not decrypt, or whose content is not an object, has an unknown kind. It stays under Saved Sessions (never in neither list) and the Backups section says how many such rows there are.
- Decision: no restore for backups on the dashboard. The session "Restore" only opens tabs in the browser; it does not write groups.
- Decrypted content is untrusted input: rebuild what is rendered from checked values, bound sizes with `AUTO_BACKUP_DOWNLOAD_LIMITS`, and only write a group colour into `style` if it matches the rgb/hex pattern (a `url(...)` value in `background` makes a network request).
- The download is the stored group entries (`JSON.stringify` of the array) minus the device sync bookkeeping keys (`LOCAL_ONLY_SYNC_KEYS`: `pendingSync`, `positionDirty`, `remoteUpdatedAt`), removed at every level by a depth-capped copy. The extension's importer validates every other field, so the dashboard does not copy that sanitiser. The extension's own `exportGroups` is a bare `JSON.stringify`; only its backup-file writer strips those keys, so that writer is the shape to match.
- Decision: deleting a backup on the dashboard removes the account's copy only; a browser that already has it keeps its own. Copy must not say or imply that devices follow the dashboard's list.
- `DELETE /api/sessions/[id]` accepts only ids matching `[A-Za-z0-9_-]{1,64}` (the extension's short ids and UUIDs both fit; `sessions.id` is a `text` column). Client code that builds the URL still wraps the id in `encodeURIComponent`.
- Time and locale formatting with `undefined` locale is safe here only because backups exist solely after the client-side decrypt, so nothing is server-rendered.

## Accounts without cloud sync (read-only)
- `sessions` RLS lets the owner SELECT and DELETE at any plan; only INSERT/UPDATE need `has_cloud_sync()`. So the page reads `sessions` for every account (`.order('created_at', desc).limit(AUTO_BACKUP_DOWNLOAD_LIMITS.rows)`), unlike `groups`, which stays gated.
- Decision: a downgraded account keeps its old rows read-only. `BackupsSection` shows the upgrade box plus `AUTO_BACKUP_COPY.readOnlyNote` and the rows (download/delete only); `SessionList readOnly` swaps the free-plan footer for `SAVED_SESSIONS_READ_ONLY_NOTE`. The page renders Saved Sessions for such an account only when raw rows exist.
- Whether backups exist is unknown until decrypt, so "show the rows part" is: synced, or error, or (ready ? backups/unknownKind > 0 : `totalRows` > 0). The "No backups yet" text describes the extension making them, so it is paid-only.
- Page tests: `__tests__/dashboard-sessions-query.test.tsx` records every builder call per table, which also proves nothing calls insert/update/upsert.

## Radix Dialog opened without a `DialogTrigger`
Radix returns focus only to its trigger. A dialog opened from state (one dialog for many rows) leaves focus on `<body>` when it closes. Remember the opener in a ref and focus it in `onCloseAutoFocus` (after `event.preventDefault()`); point the ref at a heading instead when the opener's row is about to be removed.

## Checking it in a browser
- The encrypted paid states need a real account: with the local Supabase stack, create a throwaway user with the admin API, set its `subscriptions` row to `pro`/`active`, insert an `encryption_keys` row (PBKDF2 600000 + AES-GCM wrap, same as `packages/shared/src/crypto`), insert encrypted `sessions` rows, and write the `sb-<ref>-auth-token` cookie as `e2e/auth.setup.ts` does. Delete the user afterwards.
- A screenshot taken right after a Radix dialog appears catches its slide-in animation and looks clipped at 320px. Wait about 700 ms, or read `boundingBox()`.
- To give Playwright the app's env locally: `node --env-file=.env.local node_modules/@playwright/test/cli.js test <spec>`.
