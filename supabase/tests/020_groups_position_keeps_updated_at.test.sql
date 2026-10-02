-- pgTAP test for 020_groups_position_keeps_updated_at.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
-- Last run: 17/17 assertions passed on local Supabase after `migration up --local` (supabase test db: 019 + 020, 30 tests, PASS).
--
-- Strategy: seed a group with a fixed past updated_at (the "sentinel"), apply one kind of update
-- at a time and assert whether groups_set_updated_at() kept the sentinel (position-only,
-- view_count-only) or stamped now(). now() is constant inside the transaction, so a bump is
-- asserted with is(updated_at, now()) rather than a date range. Between cases the sentinel is
-- restored with session_replication_role = replica (disables triggers; the test runner is
-- superuser). RLS cases impersonate users with `set local role authenticated` + the
-- `request.jwt.claim.sub` GUC, same as the 019 test.
--
-- Note: an identical no-op update goes through the fast path and is stamped now(), exactly like
-- the old update_updated_at(). Only position-only and view_count-only changes keep the stamp.

begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'pos-pro@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'pos-free@example.test')
on conflict (id) do nothing;

-- handle_new_user() created free/active rows; promote a1 to pro.
update public.subscriptions set tier = 'pro', status = 'active'
  where user_id = '00000000-0000-0000-0000-0000000000a1';

insert into public.groups (id, user_id, name, position, windows, starred, view_count, updated_at)
values
  ('g020', '00000000-0000-0000-0000-0000000000a1', 'orig', 0, '[]'::jsonb, false, 0, '2020-01-01T00:00:00Z'),
  ('g020-free', '00000000-0000-0000-0000-0000000000a2', 'free', 0, '[]'::jsonb, false, 0, '2020-01-01T00:00:00Z');

-- 1-2: position-only keeps the stamp
update public.groups set position = 5 where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), '2020-01-01T00:00:00Z'::timestamptz,
  'position-only update keeps updated_at');
select is((select position from public.groups where id = 'g020'), 5, 'position was applied');

-- 3: client-supplied updated_at is ignored on a position-only update
update public.groups set position = 6, updated_at = '2030-01-01T00:00:00Z' where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), '2020-01-01T00:00:00Z'::timestamptz,
  'client-supplied updated_at is ignored on a position-only update');

-- 4: view_count-only keeps the stamp
update public.groups set view_count = view_count + 1 where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), '2020-01-01T00:00:00Z'::timestamptz,
  'view_count-only update keeps updated_at');

-- 5: name change stamps now()
update public.groups set name = 'renamed' where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), now(), 'name update stamps now()');

-- 6: client-supplied updated_at overwritten on content update
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;
update public.groups set name = 'again', updated_at = '2019-01-01T00:00:00Z' where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), now(),
  'client-supplied updated_at is overwritten on a content update');

-- 7: mixed position + name stamps now()
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;
update public.groups set position = 9, name = 'mixed' where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), now(), 'position + name update stamps now()');

-- 8: windows jsonb change stamps now()
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;
update public.groups set windows = '[{"tabs":[]}]'::jsonb where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), now(), 'windows change stamps now()');

-- 9: boolean change stamps now()
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;
update public.groups set starred = true where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), now(), 'starred change stamps now()');

-- 10: fully identical no-op behaves like the old trigger (stamps now())
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;
update public.groups set name = name where id = 'g020';
select is((select updated_at from public.groups where id = 'g020'), now(),
  'identical no-op update behaves like update_updated_at() (stamps now())');

-- 11: upsert differing only in position keeps the stamp
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;
insert into public.groups (id, user_id, name, position)
values ('g020', '00000000-0000-0000-0000-0000000000a1', 'again', 42)
on conflict (id) do update set position = excluded.position;
select is((select updated_at from public.groups where id = 'g020'), '2020-01-01T00:00:00Z'::timestamptz,
  'upsert that differs only in position keeps updated_at');

-- 12: upsert with a content change stamps now()
insert into public.groups (id, user_id, name, position)
values ('g020', '00000000-0000-0000-0000-0000000000a1', 'upserted', 42)
on conflict (id) do update set name = excluded.name;
select is((select updated_at from public.groups where id = 'g020'), now(),
  'upsert with a content change stamps now()');

-- 13: regression, subscriptions_updated_at still stamps now()
set local session_replication_role = replica;
update public.subscriptions set updated_at = '2020-01-01T00:00:00Z'
  where user_id = '00000000-0000-0000-0000-0000000000a1';
set local session_replication_role = origin;
update public.subscriptions set status = 'trialing' where user_id = '00000000-0000-0000-0000-0000000000a1';
select is((select updated_at from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000a1'), now(),
  'subscriptions_updated_at still stamps now()');
update public.subscriptions set status = 'active' where user_id = '00000000-0000-0000-0000-0000000000a1';

-- 14-16: RLS, pro user position-only update succeeds and keeps the stamp
set local session_replication_role = replica;
update public.groups set updated_at = '2020-01-01T00:00:00Z' where id = 'g020';
set local session_replication_role = origin;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select lives_ok($$ update public.groups set position = 77 where id = 'g020' $$,
  'pro user position-only update is allowed by RLS');
select is((select position from public.groups where id = 'g020'), 77, 'pro user position was applied');
select is((select updated_at from public.groups where id = 'g020'), '2020-01-01T00:00:00Z'::timestamptz,
  'pro user position-only update keeps updated_at');
reset role;
reset request.jwt.claim.sub;

-- 17: RLS, free user affects 0 rows
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select is_empty($$ update public.groups set position = 5 where id = 'g020-free' returning id $$,
  'free user position-only update affects 0 rows');
reset role;
reset request.jwt.claim.sub;

select * from finish();
rollback;
