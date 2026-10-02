---
name: encryption-migration-self-heal
description: One-time-setup-flow bug fixes must self-heal accounts that already passed the trigger point, not just fix the trigger point going forward
metadata:
  type: feedback
---

A fix that only runs at the trigger-point of a one-time action (e.g. `setupEncryption()`) does
NOT retroactively fix accounts that already completed that action before the fix shipped.
`markAllGroupsPendingSync()` was added inside `setupEncryption()` (packages/extension/src/lib/encryptionKey.ts)
to re-encrypt groups on next sync — but any account that ran `setupEncryption()` before that fix
existed had `hasEncryptionKey()` already return `true` forever, so the setup modal never
reappears (per `useSync.ts`'s `doSync`) and there was no path to ever re-mark their groups dirty.
They were permanently stuck with plaintext rows in Supabase despite having a real `encryption_keys` row.

**Why:** one-time setup flows are easy to patch at the call site and declare "fixed," but any
account that already crossed that call site before the patch landed is invisible to it —
there's no natural re-trigger.

**How to apply:** for any bug fix inside a one-time setup/onboarding function, always ask "what
about accounts that already completed this flow before today?" and add a self-healing check that
runs on a recurring path (e.g. every sync cycle) rather than only at the one-time trigger. Pattern
used here: a persisted migration-done flag via `getSetting`/`setSetting` (`packages/extension/src/lib/localDb.ts`),
checked in `useSync.ts`'s `doSync` right after `hasEncryptionKey()` passes — if the flag isn't
set, run the healing action (`markAllGroupsPendingSync()`) once and set the flag. Set the flag
inside the original trigger function too, so brand-new runs of the flow don't redundantly
re-trigger the healing check on their very next cycle (harmless if it does, just wasteful).
