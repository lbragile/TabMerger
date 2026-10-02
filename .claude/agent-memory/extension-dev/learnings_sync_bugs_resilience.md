---
name: sync-bugs-resilience
description: Two real production sync bugs found on a live pro_ai account — encryption reset not re-arming sessions self-heal, and pushGroup throws silently aborting the batch loop
metadata:
  type: project
---

Found via direct Supabase inspection (a test account): only 1/N local groups reached `public.groups`, 0 sessions reached `public.sessions`.

**Sessions bug**: `resetEncryption()` in `encryptionKey.ts` cleared the `encryption_keys` row and cached key but never reset `SESSIONS_MIGRATION_DONE_KEY`. That flag gates a one-time self-heal in `useSync.ts` that re-pushes local sessions on encryption setup — if it was already `true` from a prior (pre-reset) setup, sessions saved locally never got re-pushed under the new key. Fix: `resetEncryption()` now also does `setSetting(SESSIONS_MIGRATION_DONE_KEY, false)`.

**Groups bug**: `pushGroup()` in `syncEngine.ts` had no try/catch around its body (including the `encryptBlob` call). `pushPendingChanges`'s `for` loop `await`s each `pushGroup` with no per-iteration try/catch either. Any unhandled throw inside `pushGroup` (encryption failure, malformed group content, etc.) aborted the entire loop — every group after the failing one silently never got attempted, and the outer `try/catch` in `useSync.ts`'s `doSync` just logs once with no per-group visibility. Fix: wrapped `pushGroup`'s whole body in try/catch, logging and returning per-group instead of throwing, so one bad group can't block the rest of the batch.

**Pattern to watch for elsewhere**: any `for...of` loop that `await`s a per-item async function without a try/catch either inside that function or around each iteration is a silent-batch-abort risk — the Supabase-error path (`if (!error) ... else console.error`) looked resilient but only covered the network call, not everything above it (encryption, serialization) that could throw first.
