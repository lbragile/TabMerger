---
name: learnings-encryption-cross-account-flag
description: hasEncryptionKey() cached an unscoped local flag, causing account B to see a broken unlock prompt instead of the setup modal after account A had used the same profile
metadata:
  type: project
---

Bug: `hasEncryptionKey()` in `packages/extension/src/lib/encryptionKey.ts` read a single
unscoped local IndexedDB settings boolean (`encryptionEnabled`), set `true` by
`setupEncryption()` for whichever Supabase account was signed in at that moment. If a second,
different Supabase account later signs into the same browser profile, the flag is still
`true` (nothing clears it on sign-in/out), so `useSync.ts`'s `doSync` skips the mandatory
`encryptionSetup` modal and instead shows the "Sync is locked" toast → user tries to unlock
with a passphrase → `unlockEncryption()` queries `encryption_keys` filtered by the actual
signed-in user's id, finds no row, returns `false` — indistinguishable from "wrong
passphrase" in the current UI. Account is stuck forever; it can never reach the real setup
flow.

**Fix (root cause, not per-caller patching):** rewrote `hasEncryptionKey()` to query Supabase
`encryption_keys` directly, filtered by `session.user.id` — same pattern `unlockEncryption()`
and the web app's `packages/web/lib/encryption/context.tsx` already use. Deleted the local
`encryptionEnabled` flag/key entirely (`setupEncryption()` no longer writes it). Every caller
(`Settings.tsx`, `useAI.ts`, `useSessions.ts`, `useSync.ts`, `deviceSessions.ts`,
`syncEngine.ts`) routes through this one function, so the fix cascades everywhere without
touching UI code — the Settings unlock form only renders when `hasEncryptionKey()` is true,
so once it's correctly scoped, account B automatically sees the setup modal instead of a
dead-end unlock form.

**Note:** the web app's `EncryptionKeyProvider` context was NOT affected — it already
re-queries Supabase by `user.id` on every mount, no local flag involved. Checked it
specifically for this bug class and it's clean.

**General pattern for this codebase:** any "has this one-time thing happened" flag stored in
the local `settings` IDB store (via `getSetting`/`setSetting`) is a multi-account correctness
risk if it's meant to represent per-account state — this store has no user scoping built in.
Prefer querying the authoritative Supabase table directly (mirrors [[learnings_encryption_migration_self_heal]]'s
self-heal pattern but for read-state, not one-time actions) over caching an unscoped local
boolean whenever the value differs per signed-in account.
