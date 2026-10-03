---
name: learnings-encryption-key-tristate
description: getEncryptionKeyState() tri-state (replaces hasEncryptionKey), the single content-upload gate (no plaintext branch), unlock result union, account-scoped key cache, sessions "all uploaded" flag, insert-only key setup, sync request timeouts, keyset paging, and the modal-vs-hang e2e symptom
metadata:
  type: learning
---

`hasEncryptionKey()` no longer exists (older notes still name it). Use
`getEncryptionKeyState(): 'present' | 'absent' | 'unknown'` from `lib/encryptionKey.ts`.

**A remote "does X exist" check has three answers, not two.**
- `present`: the server returned the row. `absent`: the server ANSWERED that there is none (or nobody is signed in). `unknown`: the request failed (offline, timeout, 401, 5xx) or threw.
- Rule for every caller: `unknown` is never treated as `absent`. No first-time setup UI, retry on the next poll / `online` event. `doSync` returns early; `handleSyncNow` replies `reason: 'error'`; `useOrganizeTabs` sends the local groups unless the state is `absent`; Settings shows the reset control only for `present`; the setup modal shows a retry view.
- The write is guarded too: `setupEncryption` INSERTs (never upserts). `encryption_keys.user_id` is the primary key, so the server refuses a second key (23505 becomes `ENCRYPTION_ALREADY_SET_UP_MESSAGE`, and the modal switches to its unlock form). `resetEncryption` deletes the row first, so the reset flow still works.

**One gate for every content upload, and no plaintext branch.** `getContentUploadKey()` (`lib/contentUploadKey.ts`) returns `{ key }` or `{ key: null, reason: 'no-key' | 'unknown' | 'locked' }`. Group content (`pushPendingChanges`, checked once per cycle and passed to `pushGroup`), session uploads (`pushSessionToSupabase`) and the Now Open snapshot (`deviceSessions.doPush`) encrypt with that key or send nothing. Position-only pushes are plaintext metadata and do not use it. The READ path still accepts plaintext rows (rows written before encryption existed); `markAllGroupsPendingSync` after setup re-uploads them encrypted. It lives in its own module on purpose: tests that `vi.mock('@/lib/encryptionKey')` with only `getEncryptionKeyState`/`getDataKey` keep feeding it. New code that uploads user content must go through it.

**"Pending" for data without a per-row flag:** sessions have no `pendingSync`. `SESSIONS_MIGRATION_DONE_KEY` (now in `lib/syncSettingKeys.ts`, re-exported by `encryptionKey.ts`) means "every local session is on the server, encrypted". `pushSessionToSupabase` resolves `true` only when the server accepted the row; `useSaveSession` re-arms the flag when it did not; `setupEncryption` and `resetEncryption` re-arm it; `useSync` sets it only when every push in the self-heal succeeded, and after a failed pass waits `SESSIONS_RETRY_MS` (per hook instance, a `useRef`, so tests do not leak state) before trying again. A test of that loop needs a settings mock that REMEMBERS the flag, otherwise every later poll re-runs it.

**Result unions for "the request failed" vs "the answer was no":** `unlockEncryption` returns `'unlocked' | 'wrong-passphrase' | 'no-key' | 'unavailable'`. Only a row that was read and failed to unwrap is a wrong passphrase.

**Module-scope caches must remember whose data they hold.** The in-memory data key is `{ userId, key }` and `getDataKey()` returns it only for the signed-in user: a popup or service worker outlives a sign-out.

**Symptom to recognise: "the popup never renders its header" in an e2e can be a modal, not a hang.**
A Radix Dialog sets `aria-hidden` on everything outside it, so `page.locator('header').getByRole('button')` finds nothing while the header is in the DOM. Before suspecting locks, dump: `document.querySelector('header')`, its closest `[aria-hidden]`, `[role="dialog"]` text, and `navigator.locks.query()` (held/pending).

**postgrest-js retries GET/HEAD on a network error** (3 retries, 1 s + 2 s + 4 s backoff; also on HTTP 503/520). An HTTP error such as 401 or 500 returns at once. So the same code path answers in ~100 ms against a reachable server and ~7 s against an unreachable one: an e2e that leaves a Supabase request unstubbed changes behaviour with the machine it runs on. `signInAsPro(page, 'unlocked' | 'none' | 'error')` in `e2e/helpers.ts` stubs every `**/rest/v1/**` call (catch-all registered FIRST, since Playwright gives later routes priority) and seeds the session (and, for `unlocked`, a raw base64 AES key under `dataKey_<userId>`).

**Per-request timeout:** `syncRequestSignal()` (`lib/syncRequest.ts`, `SYNC_REQUEST_TIMEOUT_MS`) goes on every request of a sync cycle via `.abortSignal(...)` (available after `.select()` on write builders and on filter builders; put it before `.maybeSingle()`). `AbortSignal.timeout` rejects with `TimeoutError`, not `AbortError`: postgrest-js then enters its retry branch, but its backoff sleep resolves immediately on an aborted signal and each retry fails at once, so the request still ends at the timeout and comes back as `{ error }`. One signal therefore bounds a request together with its retries.

**Keyset paging for "read every row" pulls:** `.eq(user).gt('id', lastId).order('id').limit(n)`; filters (`.gt`) must be chained before transforms (`.order`/`.limit`). Offsets over a mutable sort column skip a row that is updated between two page requests.

**Skipped cycle is reported:** `performSyncCycle(session)` returns `{ groups, skipped }`; `performSync` is the groups-only wrapper. `SYNC_NOW` replies `{ ok: true, skipped }`.

Test tooling:
- "Nothing leaves the device in the clear" is tested by a MARKER SCAN: `fakeRemote.writes` logs every write body for every table; the test puts unique marker strings in every content field and asserts `JSON.stringify(writes)` contains none, for key absent / unknown / locked, plus an unlocked positive control (`noPlaintextUpload.integration.test.ts`). A shape check alone would miss a field sent beside the blob.
- Fake-network integration suites mock `@/lib/encryptionKey` as present + a REAL AES key (`integration/testEncryption.ts`: `testDataKey()`, `remoteName(id)`, `remoteNames()`, `plainRow(row)`). The key lives on `globalThis`: after `vi.resetModules()` a module-scope key would be regenerated and decryption fails with "Cipher job failed".
- Real-network suites that push groups call `setupFreshEncryption(userId)` in `beforeAll` and `removeEncryption` in `afterAll` (`integration/realEncryption.ts`); "another device edits the row" must re-encrypt the blob (`editRowContentAs`), because readers ignore the plaintext `name` column of an encrypted row.
- Unit suites of upload code default to `getEncryptionKeyState -> 'present'` and `getDataKey -> {}` with `encryptBlob` mocked; with `'absent'` nothing is uploaded.
- Any Supabase mock builder used by sync code needs `abortSignal`, `gt` and `limit` returning the builder (`fakeSupabase.ts` has a `request()` thenable helper; `fakeRemote.afterPage(n, fn)` runs a server-side change between two pages of the next pull, `failAfterPages` fails later pages).
- `vi.mock('@/lib/encryptionKey')` factories must export `getEncryptionKeyState`, and `ENCRYPTION_ALREADY_SET_UP_MESSAGE` when the modal is under test. A `vi.mock('@/lib/localDb')` used with `useSessions` needs `setSetting`.
- A failed assertion inside a fake-timer test leaves fake timers installed and every later test in the file times out: wrap the body in `try { ... } finally { vi.useRealTimers() }`.
- To compare an e2e against "Supabase unreachable" without editing env files: `VITE_SUPABASE_URL=http://127.0.0.1:9 pnpm build:dev` (process env wins over `.env.local`); grep the bundle for the host, and rebuild normally afterwards.
- The first run of the real-network project after the local test users' passwords are reset can fail the realtime echo test once (no event within 8 s); the second run passes.
- The Bash tool rejects heredocs and `node -e` bodies containing an apostrophe; write scripts and JSON edit lists with Write.
