---
name: device-id-cross-account-scoping
description: getOrCreateDeviceId() keys the device UUID by user (`deviceId:${userId}`); one unscoped key gave two Supabase accounts on the same browser profile the identical device_id
metadata:
  type: project
---

Same class of bug as [[learnings_encryption_cross_account_flag]]: `deviceSessions.ts`'s `getOrCreateDeviceId()`
used to store the device UUID under one unscoped `getSetting`/`setSetting` key (`'deviceId'`), so every
account signed into the same browser profile shared the same `device_id` in `device_sessions` rows
(confirmed via a direct Supabase query: two accounts, identical `device_id`).

Not a security bug: `device_sessions` RLS already scopes strictly to `auth.uid() = user_id`, so there
was no cross-account data leak, just a wrong identity label.

The fix differs from the encryption-flag fix: the device id must stay STABLE across sessions (no server
round-trip check each call), so instead of moving to a live Supabase query like `hasEncryptionKey()`,
the local setting key itself is scoped: `deviceId:${userId}`, read/generated after calling
`supabase.auth.getSession()` inside `getOrCreateDeviceId()` itself (not threaded as a param; every
call site is already gated by tier/session context, so this is the smallest-diff fix). It falls back to
the old unscoped `'deviceId'` key only if called with no session (rare/defensive).

Decision: existing accounts sharing the old unscoped `deviceId` value are NOT migrated. Each account
lazily generates a fresh `deviceId:${userId}` on its next call. This is presence/identity metadata with
no historical-continuity requirement, so a one-time new device id per account is acceptable.

Test gotcha: `getOrCreateDeviceId()`'s dedup/in-flight-promise guard (`pending`) must also key by
user id (`pendingForUserId`), not just existence of a pending promise. Otherwise two concurrent
calls for two different users during the same tick would collapse into one shared generate+persist
and the second user would wrongly get the first user's id.
