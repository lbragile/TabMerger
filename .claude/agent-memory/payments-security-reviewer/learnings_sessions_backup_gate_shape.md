---
name: sessions-backup-gate-shape
description: How automatic backups are paid-gated: sessions RLS insert/update need has_cloud_sync, owner select/delete at any tier; the auto marker lives only in ciphertext
metadata:
  type: reference
---

Automatic backups are `sessions` rows written through `pushSessionToSupabase` (`packages/extension/src/lib/sessionUpload.ts`), the same path as manual saves. The paid gate is RLS: `sessions_insert_own` / `sessions_update_own` require `auth.uid() = user_id and has_cloud_sync(auth.uid())`; `sessions_select_own` / `sessions_delete_own` allow the owner at any tier, so a downgrade never loses access to data. `supabase/tests/019_sessions_paid_gate_rls.test.sql` pins exactly four policies with `policies_are`, so an extra permissive policy fails the suite.

The `auto` flag that separates a backup from a saved session exists only inside the encrypted `groups` blob, so the server cannot tell them apart: any retention count (backups kept per account) is enforced by the extension, and a server-side cap can only count all `sessions` rows.

`resolveTier()` (`packages/extension/src/lib/entitlementTier.ts`) grants a paid tier only for `ENTITLED_SUBSCRIPTION_STATUSES`, the same list as `has_cloud_sync()`; `entitledStatusesSqlDrift.test.ts` catches drift. A failed tier lookup returns null and the backup run is skipped, never treated as paid.

Decision: the dashboard reads `sessions` for every signed-in account (owner-scoped `.eq('user_id')`, `.limit(AUTO_BACKUP_DOWNLOAD_LIMITS.rows)`), and an account without cloud sync gets them read-only (list, download, delete through `DELETE /api/sessions/[id]`, user-scoped client). "Read-only vs full" is `hasCloudSync()` (tier + entitled status), not the bare `isPro` tier check on the same page, which stays true for a canceled Pro row. When reviewing this surface, confirm nothing in the dashboard path calls insert/update/upsert/rpc on `sessions` and the DELETE route still uses the cookie client, not service role.
