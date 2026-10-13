-- pgTAP test for the paid gate on public.sessions (policies from 019_gate_cloud_sync_rls.sql).
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: sessions rows (saved sessions and automatic backups, both stored here as
-- ciphertext) can only be written by their owner while that owner holds a paid tier with an
-- entitled status, and can always be read and deleted by their owner, whatever the tier.
--
--   write (insert, update, upsert)  -> owner + has_cloud_sync(): tier pro/pro_ai and status
--                                      active/trialing/past_due
--   read, delete                    -> owner only, no tier check, so an account that drops to
--                                      free keeps access to what it already stored
--   another account's rows          -> invisible and untouchable for everyone
--
-- 019_gate_cloud_sync_rls.test.sql already proves the has_cloud_sync() truth table, "free user
-- insert into sessions is rejected" and "pro user insert into sessions succeeds"; those three
-- are not repeated here.
--
-- How a refused write shows up depends on the statement, and the assertions pin each one:
--   insert                     -> error 42501 (the new row fails the insert policy's check)
--   update / delete            -> no error, zero rows: the policy's `using` hides the row from
--                                 the statement, so it matches nothing
--   insert ... on conflict     -> error 42501, even when the row already exists and the
--                                 statement would only update it, because the proposed row is
--                                 checked against the insert policy first
--   update that moves a row to -> error 42501 (the row is visible, the result fails the update
--   another account               policy's check)
--
-- Strategy: same as the 019, 020 and 021 tests. Insert auth.users rows so handle_new_user()
-- creates profiles and free subscriptions, move each account to the tier/status it stands for,
-- seed rows as the runner (which bypasses RLS), then impersonate each account with
-- `set local role authenticated` + the `request.jwt.claim.sub` GUC that auth.uid() reads.
-- Everything runs in one transaction that is rolled back.

begin;
select plan(47);

-- Accounts across the tier/status matrix ----------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'sessgate-free@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'sessgate-pro-active@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'sessgate-pro-canceled@example.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'sessgate-pro-trialing@example.test'),
  ('00000000-0000-0000-0000-0000000000c5', 'sessgate-pro-past-due@example.test'),
  ('00000000-0000-0000-0000-0000000000c6', 'sessgate-pro-incomplete@example.test'),
  ('00000000-0000-0000-0000-0000000000c7', 'sessgate-pro-ai-active@example.test');

update public.subscriptions set tier = 'pro', status = 'active'
  where user_id = '00000000-0000-0000-0000-0000000000c2';
update public.subscriptions set tier = 'pro', status = 'canceled'
  where user_id = '00000000-0000-0000-0000-0000000000c3';
update public.subscriptions set tier = 'pro', status = 'trialing'
  where user_id = '00000000-0000-0000-0000-0000000000c4';
update public.subscriptions set tier = 'pro', status = 'past_due'
  where user_id = '00000000-0000-0000-0000-0000000000c5';
update public.subscriptions set tier = 'pro', status = 'incomplete'
  where user_id = '00000000-0000-0000-0000-0000000000c6';
update public.subscriptions set tier = 'pro_ai', status = 'active'
  where user_id = '00000000-0000-0000-0000-0000000000c7';

-- Rows that already exist before each account acts: what an account stored while it was paid.
insert into public.sessions (id, user_id, name, description, groups) values
  ('pgtap-sessgate-free-keep',   '00000000-0000-0000-0000-0000000000c1', 'Free backup', 'original', '{"v":1,"iv":"aXY=","ct":"ZnJlZQ=="}'::jsonb),
  ('pgtap-sessgate-free-drop',   '00000000-0000-0000-0000-0000000000c1', 'Free backup to delete', 'original', '{"v":1,"iv":"aXY=","ct":"ZHJvcA=="}'::jsonb),
  ('pgtap-sessgate-pro',         '00000000-0000-0000-0000-0000000000c2', 'Pro backup', 'original', '{"v":1,"iv":"aXY=","ct":"cHJv"}'::jsonb),
  ('pgtap-sessgate-canceled',    '00000000-0000-0000-0000-0000000000c3', 'Canceled backup', 'original', '{"v":1,"iv":"aXY=","ct":"Y2FuY2VsZWQ="}'::jsonb),
  ('pgtap-sessgate-incomplete',  '00000000-0000-0000-0000-0000000000c6', 'Incomplete backup', 'original', '{"v":1,"iv":"aXY=","ct":"aW5jb21wbGV0ZQ=="}'::jsonb),
  ('pgtap-sessgate-pro-ai',      '00000000-0000-0000-0000-0000000000c7', 'Pro AI backup', 'original', '{"v":1,"iv":"aXY=","ct":"cHJvYWk="}'::jsonb);

-- Shape: the gate is only as strong as the full policy set ----------------------------------
-- Policies are permissive, so one extra insert/update policy would reopen the gate.
select policies_are(
  'public', 'sessions',
  array['sessions_select_own', 'sessions_insert_own', 'sessions_update_own', 'sessions_delete_own'],
  'sessions has exactly the four owner policies'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.sessions'::regclass),
  'row level security is enabled on sessions'
);

-- Free account: reads and deletes its own rows, writes nothing -------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

select is(
  (select count(*)::int from public.sessions where user_id = '00000000-0000-0000-0000-0000000000c1'),
  2,
  'free user can select their own sessions'
);

select is(
  (select groups::text from public.sessions where id = 'pgtap-sessgate-free-keep'),
  '{"v":1,"iv":"aXY=","ct":"ZnJlZQ=="}'::jsonb::text,
  'free user reads the stored payload of their own session (download still works)'
);

with attempted as (
  update public.sessions set name = 'Free backup renamed', description = 'changed'
  where id = 'pgtap-sessgate-free-keep'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'free user update of their own session matches no row'
);

select is(
  (select row(name, description, groups::text)::text from public.sessions where id = 'pgtap-sessgate-free-keep'),
  row('Free backup'::text, 'original'::text, '{"v":1,"iv":"aXY=","ct":"ZnJlZQ=="}'::jsonb::text)::text,
  'the free user''s session is unchanged after the refused update'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, description, groups)
     values ('pgtap-sessgate-free-keep', '00000000-0000-0000-0000-0000000000c1', 'Free backup upserted', 'changed', '[]'::jsonb)
     on conflict (id) do update
       set name = excluded.name, description = excluded.description, groups = excluded.groups $$,
  '42501',
  null,
  'free user upsert onto their own existing session is rejected'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-free-keep', '00000000-0000-0000-0000-0000000000c1', 'Free backup upserted', '[]'::jsonb)
     on conflict (id) do nothing $$,
  '42501',
  null,
  'free user insert-or-ignore onto their own existing session is rejected'
);

with attempted as (
  update public.sessions set user_id = '00000000-0000-0000-0000-0000000000c2'
  where id = 'pgtap-sessgate-free-keep'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'free user cannot hand their session to a paid account'
);

select is(
  (select count(*)::int from public.sessions where user_id <> '00000000-0000-0000-0000-0000000000c1'),
  0,
  'free user cannot select another user''s sessions'
);

with attempted as (
  update public.sessions set name = 'Taken over by free user'
  where id = 'pgtap-sessgate-pro'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'free user update of another user''s session matches no row'
);

with attempted as (
  delete from public.sessions where id = 'pgtap-sessgate-pro' returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'free user delete of another user''s session matches no row'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-free-as-pro', '00000000-0000-0000-0000-0000000000c2', 'Written as someone else', '[]'::jsonb) $$,
  '42501',
  null,
  'free user cannot insert a session under a paid user''s user_id'
);

with removed as (
  delete from public.sessions where id = 'pgtap-sessgate-free-drop' returning 1
)
select is(
  (select count(*)::int from removed),
  1,
  'free user can delete their own session'
);

select is(
  (select count(*)::int from public.sessions where user_id = '00000000-0000-0000-0000-0000000000c1'),
  1,
  'the deleted session is gone and the other one remains'
);

reset role;
reset request.jwt.claim.sub;

-- Paid tier, canceled: no writes, still reads and deletes ------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c3';

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-canceled-new', '00000000-0000-0000-0000-0000000000c3', 'Canceled new', '[]'::jsonb) $$,
  '42501',
  null,
  'canceled pro user insert into sessions is rejected'
);

with attempted as (
  update public.sessions set name = 'Canceled backup renamed'
  where id = 'pgtap-sessgate-canceled'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'canceled pro user update of their own session matches no row'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-canceled', '00000000-0000-0000-0000-0000000000c3', 'Canceled backup upserted', '[]'::jsonb)
     on conflict (id) do update set name = excluded.name, groups = excluded.groups $$,
  '42501',
  null,
  'canceled pro user upsert onto their own existing session is rejected'
);

select is(
  (select name from public.sessions where id = 'pgtap-sessgate-canceled'),
  'Canceled backup',
  'canceled pro user can still select their session, and it is unchanged'
);

with removed as (
  delete from public.sessions where id = 'pgtap-sessgate-canceled' returning 1
)
select is(
  (select count(*)::int from removed),
  1,
  'canceled pro user can still delete their session'
);

reset role;
reset request.jwt.claim.sub;

-- Paid tier, incomplete (first payment never went through): no writes ------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c6';

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-incomplete-new', '00000000-0000-0000-0000-0000000000c6', 'Incomplete new', '[]'::jsonb) $$,
  '42501',
  null,
  'incomplete pro user insert into sessions is rejected'
);

with attempted as (
  update public.sessions set name = 'Incomplete backup renamed'
  where id = 'pgtap-sessgate-incomplete'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'incomplete pro user update of their own session matches no row'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-incomplete', '00000000-0000-0000-0000-0000000000c6', 'Incomplete backup upserted', '[]'::jsonb)
     on conflict (id) do update set name = excluded.name, groups = excluded.groups $$,
  '42501',
  null,
  'incomplete pro user upsert onto their own existing session is rejected'
);

reset role;
reset request.jwt.claim.sub;

-- Entitled: active -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';

with changed as (
  update public.sessions set description = 'updated by owner'
  where id = 'pgtap-sessgate-pro'
  returning 1
)
select is(
  (select count(*)::int from changed),
  1,
  'active pro user update of their own session changes one row'
);

select lives_ok(
  $$ insert into public.sessions (id, user_id, name, description, groups)
     values ('pgtap-sessgate-pro', '00000000-0000-0000-0000-0000000000c2', 'Pro backup upserted', 'upserted by owner', '{"v":1,"iv":"aXY=","ct":"dXBzZXJ0"}'::jsonb)
     on conflict (id) do update
       set name = excluded.name, description = excluded.description, groups = excluded.groups $$,
  'active pro user upsert onto their own existing session succeeds'
);

select is(
  (select row(name, description, groups::text)::text from public.sessions where id = 'pgtap-sessgate-pro'),
  row('Pro backup upserted'::text, 'upserted by owner'::text, '{"v":1,"iv":"aXY=","ct":"dXBzZXJ0"}'::jsonb::text)::text,
  'the upsert is stored'
);

reset role;
reset request.jwt.claim.sub;

-- Entitled: trialing ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c4';

select lives_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-trialing', '00000000-0000-0000-0000-0000000000c4', 'Trialing backup', '[]'::jsonb) $$,
  'trialing pro user insert into sessions succeeds'
);

with changed as (
  update public.sessions set name = 'Trialing backup renamed'
  where id = 'pgtap-sessgate-trialing'
  returning 1
)
select is(
  (select count(*)::int from changed),
  1,
  'trialing pro user update of their own session changes one row'
);

reset role;
reset request.jwt.claim.sub;

-- Entitled: past_due (grace period) -------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c5';

select lives_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-past-due', '00000000-0000-0000-0000-0000000000c5', 'Past due backup', '[]'::jsonb) $$,
  'past_due pro user insert into sessions succeeds'
);

with changed as (
  update public.sessions set name = 'Past due backup renamed'
  where id = 'pgtap-sessgate-past-due'
  returning 1
)
select is(
  (select count(*)::int from changed),
  1,
  'past_due pro user update of their own session changes one row'
);

reset role;
reset request.jwt.claim.sub;

-- Entitled: the other paid tier -----------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c7';

select lives_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-pro-ai-new', '00000000-0000-0000-0000-0000000000c7', 'Pro AI new', '[]'::jsonb) $$,
  'active pro_ai user insert into sessions succeeds'
);

reset role;
reset request.jwt.claim.sub;

-- Paying does not open other accounts' rows ------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c2';

select is(
  (select count(*)::int from public.sessions where user_id <> '00000000-0000-0000-0000-0000000000c2'),
  0,
  'paid user sees no session that belongs to another user'
);

select is(
  (select count(*)::int from public.sessions where id = 'pgtap-sessgate-pro-ai'),
  0,
  'paid user cannot select another paid user''s session by id'
);

with attempted as (
  update public.sessions set name = 'Taken over by pro user'
  where id = 'pgtap-sessgate-pro-ai'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'paid user update of another paid user''s session matches no row'
);

with attempted as (
  update public.sessions set name = 'Taken over by pro user'
  where id = 'pgtap-sessgate-free-keep'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'paid user update of a free user''s session matches no row'
);

with attempted as (
  delete from public.sessions where id = 'pgtap-sessgate-pro-ai' returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'paid user delete of another paid user''s session matches no row'
);

with attempted as (
  delete from public.sessions where id = 'pgtap-sessgate-free-keep' returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'paid user delete of a free user''s session matches no row'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-pro-as-pro-ai', '00000000-0000-0000-0000-0000000000c7', 'Written as someone else', '[]'::jsonb) $$,
  '42501',
  null,
  'paid user cannot insert a session under another user''s user_id'
);

select throws_ok(
  $$ update public.sessions set user_id = '00000000-0000-0000-0000-0000000000c7'
     where id = 'pgtap-sessgate-pro' $$,
  '42501',
  null,
  'paid user cannot move their own session to another user'
);

-- Session ids are client-generated text, so a caller can aim an upsert at an id that already
-- belongs to someone else. The proposed row passes the insert check (own user_id, entitled);
-- the existing row must still be refused.
select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-pro-ai', '00000000-0000-0000-0000-0000000000c2', 'Overwritten by id', '[]'::jsonb)
     on conflict (id) do update
       set user_id = excluded.user_id, name = excluded.name, groups = excluded.groups $$,
  '42501',
  null,
  'paid user upsert onto another user''s session id is rejected'
);

reset role;
reset request.jwt.claim.sub;

-- Signed-out caller ------------------------------------------------------------------------------
set local role anon;

select is(
  (select count(*)::int from public.sessions),
  0,
  'a signed-out caller reads no session'
);

select throws_ok(
  $$ insert into public.sessions (id, user_id, name, groups)
     values ('pgtap-sessgate-anon', '00000000-0000-0000-0000-0000000000c2', 'Signed out', '[]'::jsonb) $$,
  '42501',
  null,
  'a signed-out caller cannot insert a session'
);

reset role;

-- End state, read as the runner (no RLS in the way) ---------------------------------------------
select is(
  (select row(user_id, name, description, groups::text)::text from public.sessions where id = 'pgtap-sessgate-free-keep'),
  row('00000000-0000-0000-0000-0000000000c1'::uuid, 'Free backup'::text, 'original'::text, '{"v":1,"iv":"aXY=","ct":"ZnJlZQ=="}'::jsonb::text)::text,
  'the free user''s session survived every refused write and delete unchanged'
);

select is(
  (select row(user_id, name, description, groups::text)::text from public.sessions where id = 'pgtap-sessgate-pro-ai'),
  row('00000000-0000-0000-0000-0000000000c7'::uuid, 'Pro AI backup'::text, 'original'::text, '{"v":1,"iv":"aXY=","ct":"cHJvYWk="}'::jsonb::text)::text,
  'the other paid user''s session survived every refused write and delete unchanged'
);

select is(
  (select row(user_id, name)::text from public.sessions where id = 'pgtap-sessgate-pro'),
  row('00000000-0000-0000-0000-0000000000c2'::uuid, 'Pro backup upserted'::text)::text,
  'the paid user''s session still belongs to them and holds only their own writes'
);

select is(
  (select row(name, description, groups::text)::text from public.sessions where id = 'pgtap-sessgate-incomplete'),
  row('Incomplete backup'::text, 'original'::text, '{"v":1,"iv":"aXY=","ct":"aW5jb21wbGV0ZQ=="}'::jsonb::text)::text,
  'the incomplete user''s session is unchanged after the refused writes'
);

select is(
  (select array_agg(id order by id) from public.sessions where id like 'pgtap-sessgate-%'),
  array[
    'pgtap-sessgate-free-keep',
    'pgtap-sessgate-incomplete',
    'pgtap-sessgate-past-due',
    'pgtap-sessgate-pro',
    'pgtap-sessgate-pro-ai',
    'pgtap-sessgate-pro-ai-new',
    'pgtap-sessgate-trialing'
  ],
  'only the allowed inserts and the two owner deletes took effect'
);

select * from finish();
rollback;
