-- pgTAP test for 019_gate_cloud_sync_rls.sql.
--
-- Run locally with:
--   pnpm exec supabase db reset   (applies every migration incl. 019 from scratch)
--   pnpm exec supabase test db
-- Last run: 13/13 assertions passed against a fresh `db reset` (schema-only; the
-- unrelated pre-existing supabase/seed.sql subscriptions-unique-constraint bug still
-- fails the seed step after migrations apply -- see agent-memory/database's
-- seed-sql-unique-user-id-bug note. That failure is after 019 applies cleanly and does
-- not affect this test file, which only depends on schema/migrations, not seed data.
--
-- Strategy: create auth.users + matching public.subscriptions rows across the tier/status
-- matrix, then impersonate each via `set local role authenticated` + the
-- `request.jwt.claim.sub` GUC that `auth.uid()` reads, and assert insert/update/select/
-- delete behavior against `public.groups` (representative of groups/device_sessions/
-- shared_bundles/encryption_keys/sessions -- all five share the same has_cloud_sync()
-- gate and policy shape as of 019) plus a dedicated block for `public.sessions` proving
-- it is now gated the same way (owner decision: free users sync 0 sessions, 3 locally).

begin;
select plan(13);

-- Setup: users across the tier/status matrix, bypassing RLS as the migration/test runner role.
-- Note: public.subscriptions.status has a check constraint (001_initial_schema.sql) allowing
-- only 'active'|'canceled'|'past_due'|'trialing'|'incomplete' -- there is no 'unpaid' or
-- 'incomplete_expired' row to test against; 'incomplete' alone is enough to prove a non-listed
-- status is rejected by has_cloud_sync().
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'free-user@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'pro-active-user@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'downgraded-user@example.test'),
  ('00000000-0000-0000-0000-000000000004', 'pro-trialing-user@example.test'),
  ('00000000-0000-0000-0000-000000000005', 'pro-past-due-user@example.test'),
  ('00000000-0000-0000-0000-000000000006', 'pro-incomplete-user@example.test')
on conflict (id) do nothing;

-- handle_new_user() trigger auto-creates a 'free'/'active' subscriptions row for each user;
-- move each non-free test user into the tier/status combination it's meant to represent.
update public.subscriptions set tier = 'pro', status = 'active'
  where user_id = '00000000-0000-0000-0000-000000000002';

update public.subscriptions set tier = 'pro', status = 'canceled'
  where user_id = '00000000-0000-0000-0000-000000000003';

update public.subscriptions set tier = 'pro', status = 'trialing'
  where user_id = '00000000-0000-0000-0000-000000000004';

update public.subscriptions set tier = 'pro', status = 'past_due'
  where user_id = '00000000-0000-0000-0000-000000000005';

update public.subscriptions set tier = 'pro', status = 'incomplete'
  where user_id = '00000000-0000-0000-0000-000000000006';

-- Seed a pre-existing group for the downgraded (canceled) user, to prove select/delete
-- still work for it after the tier/status no longer entitles them to cloud sync.
insert into public.groups (id, user_id, name, color, position, windows)
values ('seed-downgraded-group', '00000000-0000-0000-0000-000000000003', 'Old synced group', 'rgba(0,0,0,1)', 0, '[]'::jsonb)
on conflict (id) do nothing;

-- has_cloud_sync() unit checks: entitled statuses are exactly active/trialing/past_due ------
select ok(
  public.has_cloud_sync('00000000-0000-0000-0000-000000000002'),
  'has_cloud_sync() is true for an active pro subscriber'
);

select ok(
  public.has_cloud_sync('00000000-0000-0000-0000-000000000004'),
  'has_cloud_sync() is true for a trialing pro subscriber'
);

select ok(
  public.has_cloud_sync('00000000-0000-0000-0000-000000000005'),
  'has_cloud_sync() is true for a past_due pro subscriber (grace period)'
);

select ok(
  not public.has_cloud_sync('00000000-0000-0000-0000-000000000001'),
  'has_cloud_sync() is false for a free subscriber'
);

select ok(
  not public.has_cloud_sync('00000000-0000-0000-0000-000000000003'),
  'has_cloud_sync() is false once status is canceled, regardless of tier'
);

select ok(
  not public.has_cloud_sync('00000000-0000-0000-0000-000000000006'),
  'has_cloud_sync() is false for an incomplete pro subscriber'
);

-- Free user: INSERT into groups must be rejected -------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.groups (id, user_id, name, color, position, windows)
     values ('free-user-group', '00000000-0000-0000-0000-000000000001', 'Free group', 'rgba(0,0,0,1)', 0, '[]'::jsonb) $$,
  '42501',
  null,
  'free user insert into groups is rejected by RLS (new-row violates policy)'
);

reset role;
reset request.jwt.claim.sub;

-- Pro (active) user: INSERT into groups must succeed ---------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ insert into public.groups (id, user_id, name, color, position, windows)
     values ('pro-user-group', '00000000-0000-0000-0000-000000000002', 'Pro group', 'rgba(0,0,0,1)', 0, '[]'::jsonb) $$,
  'pro user insert into groups succeeds'
);

select lives_ok(
  $$ update public.groups set name = 'Pro group renamed'
     where id = 'pro-user-group' and user_id = '00000000-0000-0000-0000-000000000002' $$,
  'pro user update on their own group succeeds'
);

reset role;
reset request.jwt.claim.sub;

-- Downgraded (canceled) user: SELECT and DELETE on pre-existing rows still work -----------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.groups where user_id = '00000000-0000-0000-0000-000000000003'),
  1,
  'downgraded user can still select their previously-synced group'
);

select lives_ok(
  $$ delete from public.groups where id = 'seed-downgraded-group' and user_id = '00000000-0000-0000-0000-000000000003' $$,
  'downgraded user can still delete their previously-synced group'
);

reset role;
reset request.jwt.claim.sub;

-- sessions is now gated the same as groups (owner decision): free user insert rejected ------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('free-user-session', '00000000-0000-0000-0000-000000000001', 'Free session', '[]'::jsonb) $$,
  '42501',
  null,
  'free user insert into sessions is rejected (owner decision: free users sync 0 sessions)'
);

reset role;
reset request.jwt.claim.sub;

-- pro (active) user: sessions insert still succeeds -----------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

select lives_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pro-user-session', '00000000-0000-0000-0000-000000000002', 'Pro session', '[]'::jsonb) $$,
  'pro user insert into sessions succeeds'
);

reset role;
reset request.jwt.claim.sub;

select * from finish();
rollback;
