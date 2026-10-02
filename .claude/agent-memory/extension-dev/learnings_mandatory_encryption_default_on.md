---
name: mandatory-encryption-default-on
description: Client-side E2E encryption redesigned from opt-in toggle to mandatory/default-on — what the final shape looks like and a test-mock gotcha it exposed
metadata:
  type: project
---

Client-side E2E encryption (packages/extension) is mandatory/default-on for all users — no Settings toggle to enable/disable. Final architecture (already correct when I picked up the mid-task work):

- `lib/encryptionKey.ts`: `setupEncryption`/`unlockEncryption`/`getDataKey`/`hasEncryptionKey` only — no `disableEncryption`. `hasEncryptionKey()` reads a local `encryptionEnabled` IndexedDB setting flag (per-device "has this device completed setup/seen a key" — NOT a remote existence check).
- First-time setup is triggered automatically from `useSync.ts`'s `doSync()`: if `!(await hasEncryptionKey())`, it opens the `encryptionSetup` modal (uiStore `ModalType`) and returns early — push/pull are both skipped, never falls back to plaintext. Closes the modal once a key exists.
- `components/Modal/EncryptionSetup.tsx` is a **setup-only** modal (create passphrase, first time ever). `components/Modal/Settings.tsx`'s Account tab has an **unlock-only** section (Unlock button + passphrase input) for when `hasEncryptionKey()` is true but `getDataKey()` is null this session (service worker/popup reload cleared the in-memory key) — no setup UI there, no disable button anywhere.
- `syncEngine.ts` unconditionally checks `hasEncryptionKey()`/`getDataKey()` at push/pull boundaries (locked = skip that group, retry later — never plaintext fallback). No `isEncryptionEnabled()`-style branch to make unconditional; it was already written that way.
- `hooks/useAI.ts`'s `useOrganizeTabs` also reads `hasEncryptionKey()` — if true, the server can't read `groups.windows` (ciphertext), so it sends already-decrypted local groups in the request body instead of an empty body. Any test file that renders hooks touching `useOrganizeTabs` needs `@/lib/encryptionKey` mocked or it hits real IndexedDB (`indexedDB is not defined` in jsdom) via `hasEncryptionKey`'s `getSetting` call.

Gotcha: `@tabmerger/shared`'s `isEncryptedBlob` export must be included in any test file that mocks `@tabmerger/shared` and exercises `syncEngine.ts`'s pull/subscribe paths — missing it throws "No isEncryptedBlob export is defined on the mock" (not a silent undefined).
