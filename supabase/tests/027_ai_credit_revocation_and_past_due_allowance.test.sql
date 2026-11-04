-- pgTAP test for 027_ai_credit_revocation_and_past_due_allowance.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves:
--   - ai_credit_purchases.revoked_at and ai_usage.allowance_spent exist, nullable, with the check
--     on allowance_spent; a signed-in user can't write either.
--   - ai_reserve_credits ignores revoked packs, and counts them again once revoked_at is cleared.
--   - When ai_monthly_credits drops from > 0 to 0 (past_due), the trigger records how much of
--     this month's usage the allowance paid for (allowance_spent = least(old allowance,
--     credits_used)), so: no new managed credits, credit packs keep exactly their unspent part,
--     and with no packs every reservation is refused. A later month starts at 0.
--   - The trigger does not fire for a drop to a positive value, or without a usage row.
--   - When the payment recovers (allowance written back), the cap is the allowance again.
--   - A settlement that lowers credits_used below allowance_spent pulls allowance_spent down.
--   - The trigger functions run with an empty search_path and the API roles can't execute them;
--     anon and authenticated hold no INSERT or UPDATE privilege on either new column.
--   - The allowance counts only while the subscription is `active` (a stale positive allowance on
--     a past_due row gives nothing); packs and allowance_spent count for any status.
--   - The freeze fires only for a row that was pro_ai + managed + entitled: an incomplete row or a
--     Pro row with a stale positive allowance gets nothing back as allowance_spent.
--   - A second freeze in the same month never lowers allowance_spent.
--   - allowance_spent <= credits_used is a CHECK, not only the clamp.
--   - ai_reserve_credits locks the subscriptions row FOR SHARE first.
--
-- Everything runs in one transaction that is rolled back, so no test user is left behind.

begin;
select plan(42);

-- profiles.email is not null; a placeholder that is not an address is enough here.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000271', 'pgtap-027-a'),
  ('00000000-0000-0000-0000-000000000272', 'pgtap-027-b'),
  ('00000000-0000-0000-0000-000000000273', 'pgtap-027-c'),
  ('00000000-0000-0000-0000-000000000274', 'pgtap-027-d'),
  ('00000000-0000-0000-0000-000000000275', 'pgtap-027-e'),
  ('00000000-0000-0000-0000-000000000276', 'pgtap-027-f'),
  ('00000000-0000-0000-0000-000000000277', 'pgtap-027-g');

create temporary table this_month as
  select to_char(now() at time zone 'utc', 'YYYY-MM') as m;
grant select on this_month to service_role;

-- Columns -------------------------------------------------------------------------------------
select col_type_is('public', 'ai_credit_purchases', 'revoked_at', 'timestamp with time zone',
  'ai_credit_purchases.revoked_at is timestamptz');
select col_is_null('public', 'ai_credit_purchases', 'revoked_at', 'revoked_at is nullable (null = the pack counts)');
select col_type_is('public', 'ai_usage', 'allowance_spent', 'integer', 'ai_usage.allowance_spent is integer');
select col_is_null('public', 'ai_usage', 'allowance_spent', 'allowance_spent is nullable');

insert into public.ai_usage (user_id, month, credits_used)
values ('00000000-0000-0000-0000-000000000274', '2026-01', 5);
select throws_ok(
  $$ update public.ai_usage set allowance_spent = -1
     where user_id = '00000000-0000-0000-0000-000000000274' and month = '2026-01' $$,
  '23514', null,
  'allowance_spent cannot be negative'
);
select throws_ok(
  $$ insert into public.ai_usage (user_id, month, credits_used, allowance_spent)
     values ('00000000-0000-0000-0000-000000000274', '2026-03', 5, 6) $$,
  '23514', null,
  'allowance_spent cannot exceed credits_used (CHECK, not only the clamp)'
);
select ok(
  not has_column_privilege('anon', 'public.ai_usage', 'allowance_spent', 'UPDATE')
    and not has_column_privilege('anon', 'public.ai_usage', 'allowance_spent', 'INSERT')
    and not has_column_privilege('authenticated', 'public.ai_usage', 'allowance_spent', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.ai_usage', 'allowance_spent', 'INSERT'),
  'anon and authenticated cannot write ai_usage.allowance_spent'
);
select ok(
  not has_column_privilege('anon', 'public.ai_credit_purchases', 'revoked_at', 'UPDATE')
    and not has_column_privilege('anon', 'public.ai_credit_purchases', 'revoked_at', 'INSERT')
    and not has_column_privilege('authenticated', 'public.ai_credit_purchases', 'revoked_at', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.ai_credit_purchases', 'revoked_at', 'INSERT'),
  'anon and authenticated cannot write ai_credit_purchases.revoked_at'
);
select ok(
  position('for share' in pg_catalog.pg_get_functiondef('public.ai_reserve_credits(uuid, text, integer)'::regprocedure)) > 0,
  'ai_reserve_credits locks the subscriptions row for share before reading the cap'
);
select ok(
  not (select prosecdef from pg_catalog.pg_proc where oid = 'public.freeze_ai_allowance()'::regprocedure),
  'freeze_ai_allowance runs as the writer, not as a definer'
);

-- Triggers and functions ------------------------------------------------------------------------
select has_trigger('public', 'subscriptions', 'subscriptions_freeze_ai_allowance', 'subscriptions has the freeze trigger');
select has_trigger('public', 'ai_usage', 'ai_usage_clamp_allowance_spent', 'ai_usage has the clamp trigger');
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.freeze_ai_allowance()'::regprocedure),
  array['search_path=""'],
  'freeze_ai_allowance pins an empty search_path'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.clamp_ai_allowance_spent()'::regprocedure),
  array['search_path=""'],
  'clamp_ai_allowance_spent pins an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'public.freeze_ai_allowance()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.freeze_ai_allowance()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.clamp_ai_allowance_spent()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.clamp_ai_allowance_spent()', 'EXECUTE'),
  'anon and authenticated cannot execute the trigger functions'
);
select ok(
  not has_function_privilege('authenticated', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE'),
  'ai_reserve_credits stays service role only'
);

-- A signed-in user can't un-revoke a pack -------------------------------------------------------
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at)
values ('00000000-0000-0000-0000-000000000274', '2026-01', 500, 'cs_test_027_user_pack', now());

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000274';
select throws_ok(
  $$ update public.ai_credit_purchases set revoked_at = null
     where stripe_checkout_session_id = 'cs_test_027_user_pack' $$,
  '42501', null,
  'a signed-in user cannot clear revoked_at'
);
select throws_ok(
  $$ update public.ai_usage set allowance_spent = 1000000
     where user_id = '00000000-0000-0000-0000-000000000274' $$,
  '42501', null,
  'a signed-in user cannot write allowance_spent'
);
reset role;

-- Revoked packs -------------------------------------------------------------------------------
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000271';
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at) values
  ('00000000-0000-0000-0000-000000000271', '2026-02', 500, 'cs_test_027_revoked', now()),
  ('00000000-0000-0000-0000-000000000271', '2026-02', 200, 'cs_test_027_live', null);

set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-000000000271', '2026-02', 1)),
  1200,
  'a revoked pack does not count; an unrevoked one does'
);
reset role;

update public.ai_credit_purchases set revoked_at = null where stripe_checkout_session_id = 'cs_test_027_revoked';
set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-000000000271', '2026-02', 1)),
  1700,
  'a pack restored (dispute won) counts again'
);
reset role;

-- past_due: allowance used below the allowance, with a pack ---------------------------------------
-- User 272: allowance 1000, used 600 this month, then a 300-credit pack, then the renewal fails.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000272';
insert into public.ai_usage (user_id, month, credits_used)
  select '00000000-0000-0000-0000-000000000272', m, 600 from this_month;
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
  select '00000000-0000-0000-0000-000000000272', m, 300, 'cs_test_027_pack_272' from this_month;

update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000272';

select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000272' and u.month = t.m),
  600,
  'past_due: the trigger records the 600 credits the allowance paid for'
);

set local role service_role;
select is(
  (select row(allowed, remaining, cap)::text from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000272', t.m, 300)),
  '(t,0,900)',
  'past_due: the whole 300-credit pack is still spendable'
);
select is(
  (select allowed from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000272', t.m, 1)),
  false,
  'past_due: nothing beyond the pack (no new managed credits)'
);
select is(
  (select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-000000000272', '2099-01', 1)),
  false,
  'past_due: a later month brings no fresh allowance'
);
reset role;

-- A redelivered past_due write (already 0) does not move allowance_spent.
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000272';
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000272' and u.month = t.m),
  600,
  'writing 0 again does not re-record allowance_spent'
);

-- Recovery: the allowance is written back and is the cap again.
update public.subscriptions set status = 'active', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000272';
set local role service_role;
select is(
  (select row(allowed, remaining, cap)::text from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000272', t.m, 400)),
  '(t,0,1300)',
  'recovered: allowance + pack again, the rest of the allowance spendable'
);
reset role;

-- past_due with the allowance used up and part of a pack spent ----------------------------------
-- User 273: allowance 1000, 500-credit pack, 1200 used (all the allowance and 200 of the pack).
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000273';
insert into public.ai_usage (user_id, month, credits_used)
  select '00000000-0000-0000-0000-000000000273', m, 1200 from this_month;
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
  select '00000000-0000-0000-0000-000000000273', m, 500, 'cs_test_027_pack_273' from this_month;

update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000273';

select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000273' and u.month = t.m),
  1000,
  'allowance_spent is capped at the old allowance'
);
set local role service_role;
select is(
  (select remaining from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000273', t.m, 301)),
  300,
  'past_due: exactly the 300 unspent pack credits remain'
);
reset role;

-- The pack is then revoked (disputed): nothing at all is left.
update public.ai_credit_purchases set revoked_at = now() where stripe_checkout_session_id = 'cs_test_027_pack_273';
set local role service_role;
select is(
  (select row(allowed, remaining, cap)::text from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000273', t.m, 1)),
  '(f,0,1000)',
  'past_due with the pack revoked: every reservation refused'
);
reset role;

-- Clamp: a settlement lowers credits_used below allowance_spent.
update public.ai_usage set credits_used = 400
  from this_month t
 where user_id = '00000000-0000-0000-0000-000000000273' and month = t.m;
select is(
  (select allowance_spent || '/' || credits_used from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000273' and u.month = t.m),
  '400/400',
  'allowance_spent follows credits_used down'
);
set local role service_role;
select is(
  (select allowed from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000273', t.m, 1)),
  false,
  'after the clamp, allowance_spent alone still opens no headroom'
);
select is(
  (select public.ai_settle_credits('00000000-0000-0000-0000-000000000273', t.m, -100) from this_month t),
  300,
  'ai_settle_credits lowers credits_used'
);
reset role;
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000273' and u.month = t.m),
  300,
  'a settlement through ai_settle_credits also pulls allowance_spent down'
);

-- When the trigger does not fire ----------------------------------------------------------------
-- A drop to a positive value (e.g. a discount): nothing recorded.
update public.subscriptions set ai_monthly_credits = 500
 where user_id = '00000000-0000-0000-0000-000000000271';
insert into public.ai_usage (user_id, month, credits_used)
  select '00000000-0000-0000-0000-000000000271', m, 50 from this_month;
update public.subscriptions set ai_monthly_credits = 400
 where user_id = '00000000-0000-0000-0000-000000000271';
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000271' and u.month = t.m),
  null,
  'a lower but positive allowance records nothing'
);

-- No usage row this month: dropping to 0 creates none.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000274';
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000274';
select is(
  (select count(*)::int from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000274' and u.month = t.m),
  0,
  'no usage this month: the trigger creates no row'
);
set local role service_role;
select is(
  (select allowed from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000274', t.m, 1)),
  false,
  'past_due with nothing used and no pack: refused'
);
reset role;

-- An upsert on user_id (the webhook's write) fires the trigger too.
update public.subscriptions set status = 'active', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000271';
insert into public.subscriptions (id, user_id, tier, status, ai_mode, ai_monthly_credits)
values ('sub_test_027', '00000000-0000-0000-0000-000000000271', 'pro_ai', 'past_due', 'managed', 0)
on conflict (user_id) do update
  set id = excluded.id, status = excluded.status, ai_monthly_credits = excluded.ai_monthly_credits;
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000271' and u.month = t.m),
  50,
  'the webhook''s upsert (on conflict user_id) records allowance_spent'
);

-- Only active earns the allowance --------------------------------------------------------------
-- User 275: a past_due row still holding a positive allowance (written before this migration).
update public.subscriptions set tier = 'pro_ai', status = 'past_due', ai_mode = 'managed', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000275';
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
values ('00000000-0000-0000-0000-000000000275', '2026-05', 100, 'cs_test_027_pack_275');
set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-000000000275', '2026-05', 1)),
  100,
  'past_due with a stale positive allowance: only the pack counts'
);
reset role;

-- The freeze only for an entitled managed pro_ai row -------------------------------------------
-- User 276: incomplete with a stale positive allowance and usage this month.
update public.subscriptions set tier = 'pro_ai', status = 'incomplete', ai_mode = 'managed', ai_monthly_credits = 500
 where user_id = '00000000-0000-0000-0000-000000000276';
insert into public.ai_usage (user_id, month, credits_used)
  select '00000000-0000-0000-0000-000000000276', m, 500 from this_month;
update public.subscriptions set ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000276';
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000276' and u.month = t.m),
  null,
  'an incomplete row with credits above 0: zeroing it records nothing'
);
set local role service_role;
select is(
  (select allowed from this_month t,
     lateral public.ai_reserve_credits('00000000-0000-0000-0000-000000000276', t.m, 1)),
  false,
  'so it gets no credits back'
);
reset role;

update public.subscriptions set tier = 'pro', status = 'active', ai_monthly_credits = 500
 where user_id = '00000000-0000-0000-0000-000000000276';
update public.subscriptions set ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000276';
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000276' and u.month = t.m),
  null,
  'a Pro row with a stale allowance: zeroing it records nothing'
);

-- A second freeze in a month never lowers allowance_spent ---------------------------------------
-- User 277: allowance 1000, 600 used, past_due (600 recorded); recovers with a smaller allowance
-- (300) and fails again: the second freeze alone would compute least(300, 600) = 300.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
 where user_id = '00000000-0000-0000-0000-000000000277';
insert into public.ai_usage (user_id, month, credits_used)
  select '00000000-0000-0000-0000-000000000277', m, 600 from this_month;
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000277';
update public.subscriptions set status = 'active', ai_monthly_credits = 300
 where user_id = '00000000-0000-0000-0000-000000000277';
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
 where user_id = '00000000-0000-0000-0000-000000000277';
select is(
  (select allowance_spent from public.ai_usage u, this_month t
    where u.user_id = '00000000-0000-0000-0000-000000000277' and u.month = t.m),
  600,
  'a second freeze in the same month keeps the higher recorded value'
);

select * from finish();
rollback;
