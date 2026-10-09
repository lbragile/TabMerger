-- pgTAP test for 021_profiles_server_managed.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: profiles are not writable by their owner. A signed-in user reads their own
-- row and nothing else; the signup trigger and the service role are the only writers.
--
-- Strategy: insert two auth.users rows so the handle_new_user() trigger creates their profiles,
-- then impersonate each API role with `set local role` + the `request.jwt.claim.sub` GUC that
-- auth.uid() reads, same as the 019 and 020 tests. Everything runs in one transaction that is
-- rolled back, so no test user is left behind.
--
-- The test runner cannot become the auth service role (supabase_auth_admin), so the signup
-- inserts run as the runner. The trigger function is `security definer`, which means it runs
-- with its owner's privileges whoever inserts the user; the test asserts that and that the
-- owner can still insert profiles.
--
-- Two layers are checked separately: the table privileges (a write is refused outright,
-- 42501) and the policies (with the privilege temporarily restored inside this transaction, a
-- write still matches no row).

begin;
select plan(33);

-- Signup: an insert into auth.users fires the trigger that creates the profile --------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'profiles-owner@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'profiles-other@example.test');

select is_definer(
  'public', 'handle_new_user', array[]::text[],
  'the signup trigger function runs with its owner''s privileges'
);

select ok(
  (select has_table_privilege(p.proowner, 'public.profiles', 'INSERT')
     from pg_catalog.pg_proc p
    where p.oid = 'public.handle_new_user()'::regprocedure),
  'the signup trigger function''s owner can insert profiles'
);

select is(
  (select email from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'profiles-owner@example.test',
  'signing up creates the profile row with the account email'
);

select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')),
  2,
  'every new account gets exactly one profile row'
);

select is(
  (select stripe_customer_id from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  null,
  'a new profile has no billing customer yet'
);

select is(
  (select count(*)::int from public.subscriptions
    where user_id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')
      and tier = 'free' and status = 'active'),
  2,
  'signing up still creates the free subscription row'
);

-- Shape: one select policy, read-only privileges for the API roles --------------------------
select policies_are(
  'public', 'profiles', array['profiles_select_own'],
  'profiles has a select policy only'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
    and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.profiles', 'DELETE')
    and not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'),
  'authenticated holds no write privilege on profiles'
);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'INSERT')
    and not has_table_privilege('anon', 'public.profiles', 'UPDATE')
    and not has_table_privilege('anon', 'public.profiles', 'DELETE')
    and not has_table_privilege('anon', 'public.profiles', 'TRUNCATE'),
  'anon holds no write privilege on profiles'
);

select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    and has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'the API roles keep SELECT on profiles'
);

select ok(
  has_table_privilege('service_role', 'public.profiles', 'INSERT')
    and has_table_privilege('service_role', 'public.profiles', 'UPDATE')
    and has_table_privilege('service_role', 'public.profiles', 'DELETE'),
  'service_role keeps its write privileges on profiles'
);

-- Signed-in owner: reads own row only -------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  1,
  'a signed-in user can read their own profile'
);

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  0,
  'a signed-in user cannot read another profile'
);

select is(
  (select count(*)::int from public.profiles),
  1,
  'a signed-in user sees exactly one profile row'
);

-- Signed-in owner: profiles are not writable by their owner ---------------------------------
select throws_ok(
  $$ update public.profiles set stripe_customer_id = 'cus_test_owner_write'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501',
  null,
  'profiles are not writable by their owner: stripe_customer_id'
);

select throws_ok(
  $$ update public.profiles set email = 'profiles-changed@example.test'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501',
  null,
  'profiles are not writable by their owner: email'
);

select throws_ok(
  $$ update public.profiles set created_at = '2020-01-01T00:00:00Z'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501',
  null,
  'profiles are not writable by their owner: created_at'
);

select throws_ok(
  $$ update public.profiles set id = '00000000-0000-0000-0000-0000000000b3'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501',
  null,
  'profiles are not writable by their owner: id'
);

select throws_ok(
  $$ insert into public.profiles (id, email, stripe_customer_id)
     values ('00000000-0000-0000-0000-0000000000b1', 'profiles-owner@example.test', 'cus_test_owner_write')
     on conflict (id) do update set stripe_customer_id = excluded.stripe_customer_id $$,
  '42501',
  null,
  'profiles are not writable by their owner: upsert'
);

select throws_ok(
  $$ insert into public.profiles (id, email)
     values ('00000000-0000-0000-0000-0000000000b3', 'profiles-extra@example.test') $$,
  '42501',
  null,
  'a signed-in user cannot insert a profile row'
);

select throws_ok(
  $$ delete from public.profiles where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '42501',
  null,
  'a signed-in user cannot delete their profile row'
);

select throws_ok(
  $$ update public.profiles set stripe_customer_id = 'cus_test_owner_write'
     where id = '00000000-0000-0000-0000-0000000000b2' $$,
  '42501',
  null,
  'a signed-in user cannot update another profile'
);

reset role;
reset request.jwt.claim.sub;

select is(
  (select row(email, stripe_customer_id)::text from public.profiles
    where id = '00000000-0000-0000-0000-0000000000b1'),
  row('profiles-owner@example.test'::text, null::text)::text,
  'the owner row is unchanged after the rejected writes'
);

select is(
  (select row(email, stripe_customer_id)::text from public.profiles
    where id = '00000000-0000-0000-0000-0000000000b2'),
  row('profiles-other@example.test'::text, null::text)::text,
  'the other row is unchanged after the rejected writes'
);

-- Signed-out caller --------------------------------------------------------------------------
set local role anon;

select is(
  (select count(*)::int from public.profiles),
  0,
  'a signed-out caller reads no profile'
);

select throws_ok(
  $$ update public.profiles set stripe_customer_id = 'cus_test_anon_write' $$,
  '42501',
  null,
  'a signed-out caller cannot update profiles'
);

reset role;

-- Policy layer on its own: with the privilege restored for the rest of this transaction, an
-- owner update still matches no row, because profiles has no update policy.
grant update on public.profiles to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';

with attempted as (
  update public.profiles set stripe_customer_id = 'cus_test_owner_write'
  where id = '00000000-0000-0000-0000-0000000000b1'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'without an update policy an owner update matches no row'
);

reset role;
reset request.jwt.claim.sub;

revoke update on public.profiles from authenticated;

select is(
  (select stripe_customer_id from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  null,
  'the owner row is still unchanged'
);

-- Service role: the billing webhook path still works -----------------------------------------
set local role service_role;

select lives_ok(
  $$ update public.profiles set stripe_customer_id = 'cus_test_service_write'
     where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'a service-role update of a profile succeeds'
);

select is(
  (select stripe_customer_id from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'),
  'cus_test_service_write',
  'the service-role update is stored'
);

select is(
  (select id::text from public.profiles where stripe_customer_id = 'cus_test_service_write'),
  '00000000-0000-0000-0000-0000000000b1',
  'the service role finds the account by its billing customer'
);

select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')),
  2,
  'the service role reads every profile'
);

reset role;

-- Account removal: deleting the auth user still removes the profile -------------------------
delete from auth.users where id = '00000000-0000-0000-0000-0000000000b2';

select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
  0,
  'deleting the account removes its profile row'
);

select * from finish();
rollback;
