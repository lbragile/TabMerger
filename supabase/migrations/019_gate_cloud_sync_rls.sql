-- Close a paid-feature enforcement gap: cloud sync (Pro/Pro AI) was only enforced
-- client-side in the extension (useSync.ts checks `cloudSync` before ever calling
-- supabase.from('groups'|'device_sessions'|'shared_bundles'|'encryption_keys').upsert/insert).
-- RLS only checked `auth.uid() = user_id`, so any signed-in FREE user — via a modified
-- extension build, or a raw REST call with the public anon key that ships in the
-- extension bundle — could write sync rows directly, bypassing the client gate entirely.
-- This is now trivial to discover since the code is going public.
--
-- Scope decision per table (see migration-reviewer/payments-security-reviewer report for
-- the extension/web code evidence backing each line):
--   groups           -> GATE (insert/update). Only legitimate writer is syncEngine.ts's
--                        pushGroup(), called only when useSync's `cloudSync` entitlement
--                        is true. Web app only ever SELECTs groups (dashboard, SyncIndicator).
--   device_sessions  -> GATE (insert/update). pushDeviceSession()/fetchDeviceSessions() in
--                        deviceSessions.ts are no-ops for tier === 'free' by their own code
--                        (see doPush()'s early return), and OtherDevices.tsx's queries are
--                        `enabled: tier !== 'free'`. DevicesSection.tsx (web) only renames/
--                        deletes existing rows for the signed-in owner. No free-tier writer.
--   shared_bundles   -> GATE (insert only; there is no UPDATE policy, snapshots are
--                        immutable). SelectionActionBar.tsx disables the Share action and
--                        sharing.ts throws 'Sharing requires a Pro upgrade' when
--                        `entitlements.sharing` (== cloudSync) is false; the web app's
--                        lib/sharing.ts mirrors the same paid-only bundle scheme. SELECT
--                        stays public (`using (true)`) — that's the public share-link
--                        feature working as designed, unrelated to this gap.
--   encryption_keys  -> GATE (insert/update). EncryptionSetupModal is "triggered from
--                        useSync's doSync gate" (its own doc comment), i.e. only reachable
--                        once `cloudSync` is true. E2E encryption is Pro-only per CLAUDE.md.
--   sessions         -> GATE (insert/update), same as groups. Owner decision: free users
--                        must NOT sync sessions at all — they keep up to 3 sessions
--                        locally only. The extension's useSaveSession()/
--                        pushSessionToSupabase() free-tier upload path is being removed
--                        in the same change (extension-dev agent), so this migration and
--                        the client are updated together rather than this policy briefly
--                        being stricter than the client.
--
-- SELECT and DELETE policies are intentionally left untouched on every table: a user who
-- downgrades from Pro must still be able to read/export/delete their own previously-synced
-- data (product promise: downgrading never loses data).

-- 1. Entitlement check function -----------------------------------------------------------
-- Source of truth for which (tier, status) pairs count as "paid and entitled to cloud
-- sync" is the shared constant `ENTITLED_SUBSCRIPTION_STATUSES` in
-- packages/shared/src/constants/index.ts, which packages/extension/src/hooks/
-- useEntitlements.ts's resolveTier() reads from (extension-dev agent change, landing
-- alongside this migration). Keep this predicate byte-for-byte in sync with that
-- constant -- do not let the DB gate and the client gate diverge again.
--   - tier must be 'pro' or 'pro_ai' (packages/extension/src/lib/types.ts TIER_LIMITS —
--     only these two tiers have cloudSync: true)
--   - status must be one of 'active', 'trialing', 'past_due' (owner decision — every other
--     value permitted by subscriptions' `status` check constraint (001_initial_schema.sql:
--     'canceled', 'incomplete') is NOT entitled). current_period_end is NOT checked,
--     matching the client's resolveTier(), which never reads that column.
--
-- `security definer` + `set search_path = ''` (fully schema-qualified) is deliberate here:
-- every call site passes `auth.uid()` for `uid`, so the caller could already read their own
-- `public.subscriptions` row under `subscriptions_select_own` even as `security invoker` —
-- this isn't bypassing a restriction the caller didn't already have. It's used anyway so
-- this helper keeps working unconditionally inside a policy check regardless of future
-- changes to the `subscriptions` select policy, and the empty search_path avoids any
-- search-path-hijacking risk for a function called from RLS on every row of a hot table.
create or replace function public.has_cloud_sync(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.user_id = uid
      and s.tier in ('pro', 'pro_ai')
      and s.status in ('active', 'trialing', 'past_due')
  );
$$;

revoke execute on function public.has_cloud_sync(uuid) from public;
revoke execute on function public.has_cloud_sync(uuid) from anon;
grant execute on function public.has_cloud_sync(uuid) to authenticated;

-- 2. groups --------------------------------------------------------------------------------
drop policy if exists "groups_insert_own" on public.groups;
create policy "groups_insert_own" on public.groups
  for insert with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

drop policy if exists "groups_update_own" on public.groups;
create policy "groups_update_own" on public.groups
  for update
  using (auth.uid() = user_id and public.has_cloud_sync(auth.uid()))
  with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

-- 3. device_sessions -------------------------------------------------------------------------
drop policy if exists "device_sessions_insert_owner" on public.device_sessions;
create policy "device_sessions_insert_owner"
  on public.device_sessions for insert
  with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

drop policy if exists "device_sessions_update_owner" on public.device_sessions;
create policy "device_sessions_update_owner"
  on public.device_sessions for update
  using (auth.uid() = user_id and public.has_cloud_sync(auth.uid()))
  with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

-- 4. shared_bundles (insert only -- no update policy exists; select stays public) -----------
drop policy if exists "shared_bundles_insert_owner" on public.shared_bundles;
create policy "shared_bundles_insert_owner"
  on public.shared_bundles for insert
  to authenticated
  with check (user_id = auth.uid() and public.has_cloud_sync(auth.uid()));

-- 5. encryption_keys -------------------------------------------------------------------------
drop policy if exists "encryption_keys_insert_owner" on public.encryption_keys;
create policy "encryption_keys_insert_owner"
  on public.encryption_keys for insert
  with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

drop policy if exists "encryption_keys_update_owner" on public.encryption_keys;
create policy "encryption_keys_update_owner"
  on public.encryption_keys for update
  using (auth.uid() = user_id and public.has_cloud_sync(auth.uid()))
  with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

-- 6. sessions --------------------------------------------------------------------------------
drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own" on public.sessions
  for insert with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own" on public.sessions
  for update
  using (auth.uid() = user_id and public.has_cloud_sync(auth.uid()))
  with check (auth.uid() = user_id and public.has_cloud_sync(auth.uid()));

-- ============================================================================================
-- ROLLBACK (manual -- run these statements to restore the pre-migration policies verbatim):
--
-- drop policy if exists "groups_insert_own" on public.groups;
-- create policy "groups_insert_own" on public.groups
--   for insert with check (auth.uid() = user_id);
--
-- drop policy if exists "groups_update_own" on public.groups;
-- create policy "groups_update_own" on public.groups
--   for update using (auth.uid() = user_id);
--
-- drop policy if exists "device_sessions_insert_owner" on public.device_sessions;
-- create policy "device_sessions_insert_owner"
--   on public.device_sessions for insert
--   with check (auth.uid() = user_id);
--
-- drop policy if exists "device_sessions_update_owner" on public.device_sessions;
-- create policy "device_sessions_update_owner"
--   on public.device_sessions for update
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
--
-- drop policy if exists "shared_bundles_insert_owner" on public.shared_bundles;
-- create policy "shared_bundles_insert_owner"
--   on public.shared_bundles for insert
--   to authenticated
--   with check (user_id = auth.uid());
--
-- drop policy if exists "encryption_keys_insert_owner" on public.encryption_keys;
-- create policy "encryption_keys_insert_owner"
--   on public.encryption_keys for insert
--   with check (auth.uid() = user_id);
--
-- drop policy if exists "encryption_keys_update_owner" on public.encryption_keys;
-- create policy "encryption_keys_update_owner"
--   on public.encryption_keys for update
--   using (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
--
-- drop policy if exists "sessions_insert_own" on public.sessions;
-- create policy "sessions_insert_own" on public.sessions
--   for insert with check (auth.uid() = user_id);
--
-- drop policy if exists "sessions_update_own" on public.sessions;
-- create policy "sessions_update_own" on public.sessions
--   for update using (auth.uid() = user_id);
--
-- revoke execute on function public.has_cloud_sync(uuid) from authenticated;
-- drop function if exists public.has_cloud_sync(uuid);
-- ============================================================================================
