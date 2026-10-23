-- pgTAP test for 022_ai_byok_and_cost_credits.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves:
--   - subscriptions.ai_mode / ai_monthly_credits exist with their types, defaults and named
--     checks, and a signed-in user cannot change them on their own row (policy layer; the
--     023 test covers the privilege layer).
--   - ai_usage has the integer credits_used counter and the unique (user_id, month) key the
--     reservation's ON CONFLICT needs.
--   - ai_reserve_credits / ai_settle_credits run as their owner with an empty search_path, and
--     only the service role can call them (a signed-in user gets 42501).
--   - The cap is ai_monthly_credits only for pro_ai + managed + an entitled status, plus that
--     month's credit packs; a reservation over the cap changes nothing.
--   - Settling never takes credits_used below 0 and is a no-op without a row.
--   - Bad input (amount <= 0, malformed month) is refused.
--
-- Concurrency is not testable inside one transaction. The check and the increment are a
-- single INSERT ... ON CONFLICT DO UPDATE ... WHERE (see the migration); a two-session race was
-- run by hand on the local stack when the migration was written.
--
-- Everything runs in one transaction that is rolled back, so no test user is left behind.

begin;
select plan(53);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'ai-managed@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'ai-byok@example.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'ai-pro@example.test');

-- Columns -----------------------------------------------------------------------------------
select col_not_null('public', 'subscriptions', 'ai_mode', 'ai_mode is not null');
select col_default_is('public', 'subscriptions', 'ai_mode', 'managed', 'ai_mode defaults to managed');
select col_not_null('public', 'subscriptions', 'ai_monthly_credits', 'ai_monthly_credits is not null');
select col_default_is('public', 'subscriptions', 'ai_monthly_credits', 0, 'ai_monthly_credits defaults to 0');
select col_type_is('public', 'subscriptions', 'ai_mode', 'text', 'ai_mode is text');
select col_type_is('public', 'subscriptions', 'ai_monthly_credits', 'integer', 'ai_monthly_credits is integer');

select ok(
  exists (select 1 from pg_catalog.pg_constraint
           where conrelid = 'public.subscriptions'::regclass
             and conname = 'subscriptions_ai_mode_check' and contype = 'c'),
  'ai_mode has the named check constraint subscriptions_ai_mode_check'
);

select ok(
  exists (select 1 from pg_catalog.pg_constraint
           where conrelid = 'public.subscriptions'::regclass
             and conname = 'subscriptions_ai_monthly_credits_check' and contype = 'c'),
  'ai_monthly_credits has the named check constraint subscriptions_ai_monthly_credits_check'
);

-- What ai_reserve_credits relies on: the counter column and the ON CONFLICT target.
select col_type_is('public', 'ai_usage', 'credits_used', 'integer', 'ai_usage.credits_used is integer');
select col_is_unique('public', 'ai_usage', array['user_id', 'month'],
  'ai_usage is unique on (user_id, month)');

select is(
  (select ai_mode || ':' || ai_monthly_credits from public.subscriptions
    where user_id = '00000000-0000-0000-0000-0000000000e1'),
  'managed:0',
  'a new account starts as managed with 0 monthly credits'
);

select throws_ok(
  $$ update public.subscriptions set ai_mode = 'free_key'
     where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514', null,
  'ai_mode only accepts managed or byok'
);

select throws_ok(
  $$ update public.subscriptions set ai_monthly_credits = -1
     where user_id = '00000000-0000-0000-0000-0000000000e1' $$,
  '23514', null,
  'ai_monthly_credits cannot be negative'
);

-- Server-written only -----------------------------------------------------------------------
select policies_are('public', 'subscriptions', array['subscriptions_select_own'],
  'subscriptions has a select policy only');
select policies_are('public', 'ai_usage', array['Users can read own usage'],
  'ai_usage has a select policy only');
select policies_are('public', 'ai_credit_purchases', array['Users can read own credit purchases'],
  'ai_credit_purchases has a select policy only');

-- Functions: definer, empty search_path, service role only ----------------------------------
select is_definer('public', 'ai_reserve_credits', array['uuid', 'text', 'integer'],
  'ai_reserve_credits is security definer');
select is_definer('public', 'ai_settle_credits', array['uuid', 'text', 'integer'],
  'ai_settle_credits is security definer');

select is(
  (select proconfig from pg_catalog.pg_proc
    where oid = 'public.ai_reserve_credits(uuid, text, integer)'::regprocedure),
  array['search_path=""'],
  'ai_reserve_credits pins an empty search_path'
);

select is(
  (select proconfig from pg_catalog.pg_proc
    where oid = 'public.ai_settle_credits(uuid, text, integer)'::regprocedure),
  array['search_path=""'],
  'ai_settle_credits pins an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.ai_settle_credits(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_settle_credits(uuid, text, integer)', 'EXECUTE'),
  'anon and authenticated cannot execute either function'
);

select ok(
  has_function_privilege('service_role', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_settle_credits(uuid, text, integer)', 'EXECUTE'),
  'service_role can execute both functions'
);

-- Signed-in user: no RPC, no writes to their allowance --------------------------------------
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_monthly_credits = 100
 where user_id = '00000000-0000-0000-0000-0000000000e1';

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';

select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 1) $$,
  '42501', null,
  'a signed-in user cannot reserve credits directly'
);

select throws_ok(
  $$ select public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', -5) $$,
  '42501', null,
  'a signed-in user cannot settle credits directly'
);

-- 023 revokes the API roles' write privileges, so this update fails with 42501 once 023 is
-- applied (pinned by the 023 test). Grant the privilege back inside this rolled-back
-- transaction to prove the policy layer alone still hides the row.
reset role;
grant update on public.subscriptions to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';

with x as (
  update public.subscriptions set ai_monthly_credits = 999999, ai_mode = 'managed'
   where user_id = '00000000-0000-0000-0000-0000000000e1'
  returning 1
)
select is((select count(*)::int from x), 0, 'a signed-in user cannot raise their own monthly credits');

select is(
  (select ai_monthly_credits from public.subscriptions
    where user_id = '00000000-0000-0000-0000-0000000000e1'),
  100,
  'a signed-in user still reads their own monthly credits'
);

reset role;

-- Reserve: managed pro_ai -------------------------------------------------------------------
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id) values
  ('00000000-0000-0000-0000-0000000000e1', '2026-10', 820, 'cs_test_022_pack'),
  ('00000000-0000-0000-0000-0000000000e1', '2026-10', 30, 'grant_00000000-0000-0000-0000-000000000022');

set local role service_role;

select is(
  (select row(allowed, remaining, cap)::text
     from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 900)),
  '(t,50,950)',
  'cap = monthly credits + packs and grants of that month; a fitting reservation is allowed'
);

select is(
  (select row(allowed, remaining, cap)::text
     from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 51)),
  '(f,50,950)',
  'a reservation over the remaining allowance is refused'
);

select is(
  (select credits_used from public.ai_usage
    where user_id = '00000000-0000-0000-0000-0000000000e1' and month = '2026-10'),
  900,
  'a refused reservation changes nothing'
);

select is(
  (select row(allowed, remaining, cap)::text
     from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 50)),
  '(t,0,950)',
  'a reservation may use the allowance exactly'
);

select is(
  (select row(allowed, remaining, cap)::text
     from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-11', 101)),
  '(f,100,100)',
  'packs count only in their own month'
);

select is(
  (select count(*)::int from public.ai_usage
    where user_id = '00000000-0000-0000-0000-0000000000e1' and month = '2026-11'),
  0,
  'a refused first reservation of a month creates no usage row'
);

-- Settle ------------------------------------------------------------------------------------
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', -200),
  750,
  'settling with a negative delta lowers credits_used'
);

select is(
  public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 5),
  755,
  'settling with a positive delta raises credits_used'
);

select is(
  public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', -100000),
  0,
  'settling never takes credits_used below 0'
);

select is(
  public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '2026-01', -5),
  null::integer,
  'settling a month without a usage row returns null'
);

select is(
  (select count(*)::int from public.ai_usage
    where user_id = '00000000-0000-0000-0000-0000000000e1' and month = '2026-01'),
  0,
  'settling a month without a usage row creates none'
);

-- Statuses: mirrors ENTITLED_SUBSCRIPTION_STATUSES -----------------------------------------
reset role;
update public.subscriptions set status = 'trialing' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-12', 1)),
  100, 'trialing counts the monthly credits'
);

reset role;
update public.subscriptions set status = 'past_due' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-12', 1)),
  100, 'past_due counts the monthly credits'
);

reset role;
update public.subscriptions set status = 'incomplete' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-12', 1)),
  0, 'incomplete does not count the monthly credits'
);

reset role;
update public.subscriptions set status = 'canceled' where user_id = '00000000-0000-0000-0000-0000000000e1';
set local role service_role;
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-12', 1)),
  0, 'canceled does not count the monthly credits'
);

select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 1)),
  850, 'a canceled subscription keeps only the packs of the month'
);

-- Other plans -------------------------------------------------------------------------------
reset role;
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'byok', ai_monthly_credits = 100
 where user_id = '00000000-0000-0000-0000-0000000000e2';
update public.subscriptions set tier = 'pro', status = 'active', ai_monthly_credits = 100
 where user_id = '00000000-0000-0000-0000-0000000000e3';
set local role service_role;

select is(
  (select row(allowed, remaining, cap)::text
     from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e2', '2026-10', 1)),
  '(f,0,0)',
  'a byok subscription has no managed allowance'
);

select is(
  (select row(allowed, remaining, cap)::text
     from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e3', '2026-10', 1)),
  '(f,0,0)',
  'a pro subscription has no AI allowance even with ai_monthly_credits set'
);

-- Input validation --------------------------------------------------------------------------
select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', 0) $$,
  '22023', null, 'a zero reservation is refused'
);

select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', -5) $$,
  '22023', null, 'a negative reservation is refused'
);

select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-13', 1) $$,
  '22023', null, 'month 13 is refused'
);

select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-1', 1) $$,
  '22023', null, 'a one-digit month is refused'
);

select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', '2026-10-01', 1) $$,
  '22023', null, 'a full date is refused'
);

select throws_ok(
  $$ select * from public.ai_reserve_credits('00000000-0000-0000-0000-0000000000e1', null, 1) $$,
  '22023', null, 'a null month is refused'
);

select throws_ok(
  $$ select * from public.ai_reserve_credits(null, '2026-10', 1) $$,
  '22004', null, 'a null user is refused'
);

select throws_ok(
  $$ select public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '26-10', -1) $$,
  '22023', null, 'settle refuses a malformed month'
);

select throws_ok(
  $$ select public.ai_settle_credits('00000000-0000-0000-0000-0000000000e1', '2026-10', null) $$,
  '22004', null, 'settle refuses a null delta'
);

reset role;

select * from finish();
rollback;
