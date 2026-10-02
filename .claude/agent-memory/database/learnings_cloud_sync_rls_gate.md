---
name: cloud-sync-rls-gap
description: Cloud sync (Pro) is enforced by RLS since migration 019 — all five sync tables gated on INSERT/UPDATE via has_cloud_sync(), including sessions
metadata:
  type: project
---

Before migration 019, cloud sync (Pro/Pro AI) was enforced only client-side in the extension
(`useSync.ts`'s `if (!session || !cloudSync) return;`), and RLS on `groups`, `sessions`,
`device_sessions`, `shared_bundles`, `encryption_keys` only checked `auth.uid() = user_id`.
`supabase/migrations/019_gate_cloud_sync_rls.sql` (applied) closes that with a
`public.has_cloud_sync(uid)` policy helper (security definer, stable, empty search_path)
gating INSERT/UPDATE on all five tables. SELECT/DELETE stay owner-only everywhere so a
downgraded user keeps read/export/delete access, which is an explicit product promise.

**History on `sessions`:** a first draft of this migration left `sessions` ungated, because
`useSessions.ts`'s `useSaveSession()` then only enforced a *count* limit for free users
(`FREE_SESSION_LIMIT = 3` when `!hasSessions`) and best-effort pushed every saved session to
Supabase regardless of entitlement, while the pricing copy marketed "Session save & restore"
as Pro-only. Decision: follow the pricing copy. Free users keep sessions local-only (3 max,
never synced), the free-tier upload path was removed in the same change, and `sessions` is
gated identically to `groups`. If `sessions` shows up ungated in a future diff, that's a
regression, not a stable design choice.

**Entitled statuses:** Decision: the DB gate (and the client, updated in lockstep) treats only
`active`, `trialing`, `past_due` as entitled; `incomplete`, `incomplete_expired`, `unpaid`,
`paused` and `canceled` are NOT entitled. This is stricter than the original `resolveTier()`
(which only excluded `canceled`). The source of truth is the shared constant
`ENTITLED_SUBSCRIPTION_STATUSES` in `packages/shared/src/constants/index.ts`; keep
`has_cloud_sync()`'s `status in (...)` list byte-for-byte in sync with it.

**Why:** found while auditing every paid-gated table before writing migration 019, via
`useSessions.ts` and `useEntitlements.ts`/`types.ts`. The status-list tightening and the
`sessions` reversal were explicit product decisions, not re-derived from the code, so don't
assume future gates should also tighten the status list without checking the current policy.

**How to apply:** when auditing or extending RLS on `sessions`, `groups`, `device_sessions`,
`shared_bundles`, or `encryption_keys` for paid-feature enforcement, re-check the *actual*
current-code write path (grep for `.from('<table>')` call sites and trace whether an
entitlement check gates them) rather than trusting the marketing/pricing copy in
`packages/shared/src/constants/index.ts` alone; they drifted apart once already.
See [[has-cloud-sync-function-notes]] for the entitlement-matching details.
