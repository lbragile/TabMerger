-- 023_revoke_client_writes_billing_tables.sql
--
-- subscriptions, ai_usage and ai_credit_purchases decide what a user is entitled to and how
-- much AI cost TabMerger pays for them (022). Their rows are written only by the server:
--   - subscriptions: the signup trigger (handle_new_user(), security definer) creates the free
--     row; the Stripe webhook (service role) maintains it.
--   - ai_usage: ai_reserve_credits / ai_settle_credits (security definer, service role only)
--     and the dev-only /api/ai/dev-usage route (service role).
--   - ai_credit_purchases: the Stripe webhook (service role) and manual grants.
-- Each table already has one select-only policy, so a client write matches no row. This adds
-- the second layer, the same as 021 did for profiles: the API roles lose the write privileges,
-- so a client write is refused outright (42501, HTTP 403 from PostgREST) and stays refused
-- even if a write policy is ever added by mistake.
--
-- What this does:
--   1. Leaves anon and authenticated with no INSERT, UPDATE, DELETE or TRUNCATE on the three
--      tables (granted by the platform defaults and 010). Their SELECT is untouched, and RLS
--      still limits it to the signed-in user's own rows. service_role and the table owner keep
--      full access, so the webhook, the trigger and the credit functions are unaffected.
--   2. Checks the end state and fails the migration if it is not the one described above.
--
-- No client code writes these tables: the web app and the extension only select from them
-- with a user session; every write goes through the service role or a definer function.
--
-- Idempotent: `revoke` is a no-op when there is nothing left to remove, and a table-level
-- revoke also removes matching column-level grants.
--
-- Rollback (restores the table privileges from 010):
--   grant insert, update, delete, truncate
--     on public.subscriptions, public.ai_usage, public.ai_credit_purchases
--     to anon, authenticated;

-- 1. Privileges: read only for the API roles ------------------------------------------------
revoke insert, update, delete, truncate
  on public.subscriptions, public.ai_usage, public.ai_credit_purchases
  from anon, authenticated;

-- 2. End-state check ------------------------------------------------------------------------
do $$
declare
  tbl text;
  api_role text;
  write_priv text;
  extra_policy text;
begin
  foreach tbl in array array['public.subscriptions', 'public.ai_usage', 'public.ai_credit_purchases'] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      foreach write_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        if has_table_privilege(api_role, tbl, write_priv) then
          raise exception '%: role % still holds %', tbl, api_role, write_priv;
        end if;
      end loop;

      -- Column-level grants (INSERT/UPDATE only; DELETE and TRUNCATE have no column form).
      foreach write_priv in array array['INSERT', 'UPDATE'] loop
        if has_any_column_privilege(api_role, tbl, write_priv) then
          raise exception '%: role % still holds % on a column', tbl, api_role, write_priv;
        end if;
      end loop;

      if not has_table_privilege(api_role, tbl, 'SELECT') then
        raise exception '%: role % has no SELECT', tbl, api_role;
      end if;
    end loop;

    foreach write_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', tbl, write_priv) then
        raise exception '%: service_role has no %', tbl, write_priv;
      end if;
    end loop;

    if not exists (
      select 1 from pg_catalog.pg_class
      where oid = tbl::regclass and relrowsecurity
    ) then
      raise exception '%: row level security is not enabled', tbl;
    end if;
  end loop;

  select tablename || '."' || policyname || '"' into extra_policy
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('subscriptions', 'ai_usage', 'ai_credit_purchases')
    and cmd <> 'SELECT'
  limit 1;

  if extra_policy is not null then
    raise exception 'unexpected non-select policy %', extra_policy;
  end if;
end;
$$;
