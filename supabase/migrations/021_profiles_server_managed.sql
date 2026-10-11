-- 021_profiles_server_managed.sql
--
-- profiles rows are written only by the server: the signup trigger (handle_new_user(),
-- security definer) creates the row and the billing webhook (service role) maintains it.
-- Users read their own row through "profiles_select_own" (002), which is unchanged.
--
-- What this does:
--   1. Removes the owner update policy, leaving select as the only policy on the table.
--   2. Leaves anon and authenticated with no write privilege on the table (insert, update,
--      delete, truncate). Their SELECT grant is untouched, and RLS still limits it to the
--      row of the signed-in user. service_role and the table owner keep full access, so the
--      trigger and the webhook are unaffected.
--   3. Checks the end state and fails the migration if it is not the one described above.
--
-- No column on this table is edited by its owner: id and email are copied from auth.users at
-- signup, stripe_customer_id is set by the billing webhook, created_at is a default.
--
-- Idempotent: `drop policy if exists` and `revoke` are both no-ops when there is nothing left
-- to remove, so this is safe to run on a database where the same statements were already run
-- by hand.
--
-- Rollback (restores the 002 policy and the table privileges):
--   grant insert, update, delete, truncate on public.profiles to anon, authenticated;
--   drop policy if exists "profiles_update_own" on public.profiles;
--   create policy "profiles_update_own" on public.profiles
--     for update using (auth.uid() = id);

-- 1. Policies: select only ------------------------------------------------------------------
drop policy if exists "profiles_update_own" on public.profiles;

-- 2. Privileges: read only for the API roles ------------------------------------------------
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;

-- 3. End-state check ------------------------------------------------------------------------
do $$
declare
  api_role text;
  write_priv text;
  extra_policy text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    foreach write_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(api_role, 'public.profiles', write_priv) then
        raise exception 'public.profiles: role % still holds %', api_role, write_priv;
      end if;
    end loop;

    if not has_table_privilege(api_role, 'public.profiles', 'SELECT') then
      raise exception 'public.profiles: role % has no SELECT', api_role;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.profiles', 'UPDATE') then
    raise exception 'public.profiles: service_role has no UPDATE';
  end if;

  select policyname into extra_policy
  from pg_catalog.pg_policies
  where schemaname = 'public' and tablename = 'profiles' and cmd <> 'SELECT'
  limit 1;

  if extra_policy is not null then
    raise exception 'public.profiles: unexpected non-select policy "%"', extra_policy;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.profiles'::regclass and relrowsecurity
  ) then
    raise exception 'public.profiles: row level security is not enabled';
  end if;
end;
$$;
