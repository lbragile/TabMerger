---
name: learnings-encryption-locked-sync-silent-gap
description: MV3 popup teardown clears the in-memory data key every session; doSync had no gate for "has key but locked", so sync silently no-op'd forever after the first setup
metadata:
  type: project
---

Real production bug (found via live console log): `[SyncEngine] Encryption enabled but key
is locked — skipping push for <id>` on every popup open after the very first encryption
setup. Root cause: `encryptionKey.ts`'s `cachedDataKey` is module-scope, in-memory only by
design (never persisted unwrapped) — but MV3 popups are fully torn down on close (not
hidden), so it resets to `null` every single popup open. `useSync.ts`'s `doSync` only had a
gate for "no `encryption_keys` row yet" (`hasEncryptionKey()` false → blocking
`encryptionSetup` modal). It had no gate for "row exists, but `getDataKey()` is null this
session" — it just called `pushPendingChanges`/`pullRemoteChanges`, which internally call
`getDataKey()`, get `null`, and silently skip each group with only a `console.warn`
(`syncEngine.ts` `pushGroup` ~line 24-29, and the analogous skip in `deviceSessions.ts`'s
`doPush` and the decrypt path in `syncEngine.ts`'s pull). Net effect: sync stayed broken
forever for every returning session, invisibly.

Fix: added a third gate in `doSync` — `hasEncryptionKey()` true AND `getDataKey()` null →
skip push/pull entirely (they'd no-op anyway) and show a **dismissible sonner toast**
("Sync is locked" + action button opening Settings), gated by a `useRef` so it only fires
once per popup session even though `doSync` reruns on a 30s poll. Deliberately did NOT
reuse the blocking `encryptionSetup` modal pattern for this — that steals focus every
single popup open, which is fine for "no key exists at all" (genuinely broken state) but
too much friction for "key exists, just needs a passphrase re-entry," which is lower-risk
(data stays unsynced-but-safe, never leaks plaintext).

Reused rather than rebuilt: `Settings.tsx`'s Account tab already had a full unlock UI
(passphrase input + `unlockEncryption()` call, `encHasKey`/`encUnlocked` local state) built
by an earlier agent in the same session — no new modal/component was needed, just routing
the toast's action button to `openModal('settings')`.

Test mock gotcha: `useSync.test.ts` mocks `@/lib/encryptionKey` entirely, so adding the new
`getDataKey` gate required adding `getDataKey: mockGetDataKey` to that `vi.mock` factory —
every existing test in the file implicitly assumed the key was unlocked (needed a default
`mockGetDataKey.mockReturnValue({})` in `beforeEach`, since `vi.clearAllMocks()` does not
reset a mock's configured return value, only `resetAllMocks()` does).

See also [[learnings_encryption_migration_self_heal]] for the related "self-heal accounts
already past the trigger point" pattern used in the adjacent migration gate in the same
function.
