-- pgTAP test for 029_ai_credit_purchases_carried_from_month.sql and 030_ai_billing_period_credits.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves:
--   - ai_allowance_month() gives the expected key for every row of the case table below. The same
--     table is read by packages/web/__tests__/aiAllowanceMonthSqlDrift.test.ts and checked against
--     the TS aiAllowanceMonth(), so the two implementations agree on every case.
--   - One payment funds one allowance: spend on Oct 31 and Nov 1 lands on one key, and the second
--     day gets only what is left. A renewal's new period resets; a yearly anniversary resets.
--   - A stored period with no renewal gives no fresh bucket; a renewal into past_due gives none.
--   - The period can't move backwards for the same subscription id, and a new id takes its own.
--   - The freeze stamps allowance_spent on the key of the OLD period, when a new period and an
--     allowance of 0 are written together, and when only the allowance is.
--   - ai_settle_credits: a positive delta stops at the cap (over, under, at it, with packs, with a
--     revoked pack, frozen) and doesn't lower a value already over it; a negative delta is as before.
--   - ai_credit_cap equals the cap ai_reserve_credits reports; ai_credits_exhausted stays never
--     stricter than ai_reserve_credits.
--   - A pack bought while a renewal awaits payment is spendable on the old key, and what is unspent
--     of it moves to the new key when the period advances, without giving back what was spent. A
--     period cut short carries every pack the same way, on the same id or a new one.
--   - ai_grant_credit_pack reads the key under the subscriptions lock; a repeat is a no-op.
--   - The API roles can't write the new columns or execute the new functions.
--
-- Everything runs in one transaction that is rolled back, so no test user is left behind.

begin;
select plan(125);

-- profiles.email is not null; a placeholder that is not an address is enough here.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000291', 'pgtap-030-a'),
  ('00000000-0000-0000-0000-000000000292', 'pgtap-030-b'),
  ('00000000-0000-0000-0000-000000000293', 'pgtap-030-c'),
  ('00000000-0000-0000-0000-000000000294', 'pgtap-030-d'),
  ('00000000-0000-0000-0000-000000000295', 'pgtap-030-e'),
  ('00000000-0000-0000-0000-000000000296', 'pgtap-030-f'),
  ('00000000-0000-0000-0000-000000000297', 'pgtap-030-g'),
  ('00000000-0000-0000-0000-000000000298', 'pgtap-030-h'),
  ('00000000-0000-0000-0000-0000000002a1', 'pgtap-030-i'),
  ('00000000-0000-0000-0000-0000000002a2', 'pgtap-030-j'),
  ('00000000-0000-0000-0000-0000000002a3', 'pgtap-030-k'),
  ('00000000-0000-0000-0000-0000000002a4', 'pgtap-030-l'),
  ('00000000-0000-0000-0000-0000000002a5', 'pgtap-030-m'),
  ('00000000-0000-0000-0000-0000000002a6', 'pgtap-030-n'),
  ('00000000-0000-0000-0000-0000000002a7', 'pgtap-030-o'),
  ('00000000-0000-0000-0000-0000000002a8', 'pgtap-030-p'),
  ('00000000-0000-0000-0000-0000000002a9', 'pgtap-030-q'),
  ('00000000-0000-0000-0000-0000000002b1', 'pgtap-030-r');

-- Columns, grants -------------------------------------------------------------------------------
select col_type_is('public', 'subscriptions', 'ai_period_start', 'timestamp with time zone', 'ai_period_start is timestamptz');
select col_is_null('public', 'subscriptions', 'ai_period_start', 'ai_period_start is nullable');
select col_type_is('public', 'subscriptions', 'ai_period_end', 'timestamp with time zone', 'ai_period_end is timestamptz');
select col_is_null('public', 'subscriptions', 'ai_period_end', 'ai_period_end is nullable');
select ok(
  not has_column_privilege('anon', 'public.subscriptions', 'ai_period_start', 'UPDATE')
    and not has_column_privilege('anon', 'public.subscriptions', 'ai_period_start', 'INSERT')
    and not has_column_privilege('authenticated', 'public.subscriptions', 'ai_period_start', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.subscriptions', 'ai_period_start', 'INSERT')
    and not has_column_privilege('anon', 'public.subscriptions', 'ai_period_end', 'UPDATE')
    and not has_column_privilege('anon', 'public.subscriptions', 'ai_period_end', 'INSERT')
    and not has_column_privilege('authenticated', 'public.subscriptions', 'ai_period_end', 'UPDATE')
    and not has_column_privilege('authenticated', 'public.subscriptions', 'ai_period_end', 'INSERT'),
  'anon and authenticated cannot write the period columns'
);
select ok(
  has_column_privilege('authenticated', 'public.subscriptions', 'ai_period_start', 'SELECT')
    and has_column_privilege('authenticated', 'public.subscriptions', 'ai_period_end', 'SELECT'),
  'authenticated can read them (the extension computes its display key from them, RLS limits it to its own row)'
);
select ok(
  not has_function_privilege('anon', 'public.ai_allowance_month(timestamptz, timestamptz, timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_allowance_month(timestamptz, timestamptz, timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.ai_credit_cap(uuid, text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_credit_cap(uuid, text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.keep_ai_period()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.keep_ai_period()', 'EXECUTE'),
  'anon and authenticated cannot execute the new functions'
);
select ok(
  not has_function_privilege('anon', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.ai_settle_credits(uuid, text, integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_settle_credits(uuid, text, integer)', 'EXECUTE'),
  'anon and authenticated still cannot execute reserve or settle'
);
select ok(
  has_function_privilege('service_role', 'public.ai_allowance_month(timestamptz, timestamptz, timestamptz)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_credit_cap(uuid, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_reserve_credits(uuid, text, integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_settle_credits(uuid, text, integer)', 'EXECUTE'),
  'service_role can execute the key, cap, reserve and settle functions'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.ai_allowance_month(timestamptz, timestamptz, timestamptz)'::regprocedure),
  array['search_path=""'],
  'ai_allowance_month pins an empty search_path'
);
select is(
  (select proconfig from pg_catalog.pg_proc where oid = 'public.ai_credit_cap(uuid, text)'::regprocedure),
  array['search_path=""'],
  'ai_credit_cap pins an empty search_path'
);
select ok(
  position('for share' in pg_catalog.pg_get_functiondef('public.ai_settle_credits(uuid, text, integer)'::regprocedure))
    < position('ai_credit_cap' in pg_catalog.pg_get_functiondef('public.ai_settle_credits(uuid, text, integer)'::regprocedure)),
  'ai_settle_credits locks the subscriptions row before it reads the cap'
);
select results_eq(
  $$ select pg_catalog.pg_get_function_result('public.ai_reserve_credits(uuid, text, integer)'::regprocedure) $$,
  $$ values ('TABLE(allowed boolean, remaining integer, cap integer)'::text) $$,
  'ai_reserve_credits keeps its return shape'
);

-- The key: the case table both implementations are checked against ------------------------------
-- Columns: start, end, now, expected, label. Keep one case per line: the Vitest side parses them.
create temporary table agreement (period_start text, period_end text, at text, expected text, label text);
insert into agreement values
-- AGREEMENT CASES START
  (null, null, '2026-11-01T00:00:00Z', '2026-11', 'null period: calendar month at its first second'),
  (null, null, '2026-10-31T23:59:59Z', '2026-10', 'null period: calendar month at its last second'),
  (null, '2026-12-01T00:00:00Z', '2026-11-15T00:00:00Z', '2026-11', 'null start: calendar month'),
  ('2026-10-01T00:00:00Z', null, '2026-11-15T00:00:00Z', '2026-11', 'null end: calendar month'),
  ('2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z', '2026-10-31T10:00:00Z', '2026-10', 'monthly: at the start'),
  ('2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z', '2026-11-01T00:00:00Z', '2026-10', 'monthly: the 1st of the next month stays on the start month'),
  ('2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z', '2026-11-30T09:59:59Z', '2026-10', 'monthly: last second of the period'),
  ('2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z', '2026-11-30T10:00:00Z', '2026-10', 'monthly: at the end, no renewal written, keeps the key'),
  ('2026-10-31T10:00:00Z', '2026-11-30T10:00:00Z', '2027-06-01T00:00:00Z', '2026-10', 'monthly: long past the end keeps the key'),
  ('2026-11-30T10:00:00Z', '2026-12-31T10:00:00Z', '2026-12-15T00:00:00Z', '2026-11', 'monthly anchor 31: Nov 30 to Dec 31'),
  ('2027-01-31T10:00:00Z', '2027-02-28T10:00:00Z', '2027-02-10T00:00:00Z', '2027-01', 'monthly anchor 31: Jan 31 to Feb 28'),
  ('2027-02-28T10:00:00Z', '2027-03-31T10:00:00Z', '2027-03-29T00:00:00Z', '2027-02', 'monthly anchor 31: Feb 28 to Mar 31, past Mar 28 stays on February'),
  ('2028-02-29T10:00:00Z', '2028-03-31T10:00:00Z', '2028-03-30T00:00:00Z', '2028-02', 'monthly anchor 31, leap: Feb 29 to Mar 31'),
  ('2028-01-30T10:00:00Z', '2028-02-29T10:00:00Z', '2028-02-29T09:00:00Z', '2028-01', 'monthly anchor 30, leap: Jan 30 to Feb 29'),
  ('2026-12-15T00:00:00Z', '2027-01-15T00:00:00Z', '2027-01-01T00:00:00Z', '2026-12', 'monthly across New Year'),
  ('2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z', '2026-11-01T12:00:00Z', '2026-10', 'exactly 32 days is one allowance month'),
  ('2026-10-01T00:00:00Z', '2026-11-02T00:00:01Z', '2026-11-01T12:00:00Z', '2026-11', 'over 32 days has anniversaries'),
  ('2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z', '2026-12-15T00:00:00Z', '2026-10', 'exactly 32 days, past its end: still one allowance month'),
  ('2026-10-31T10:00:00Z', '2026-12-02T10:00:00Z', '2026-11-30T10:00:00Z', '2026-10', 'a yearly plan cut to exactly 32 days: its Nov 30 anniversary does not count'),
  ('2026-10-31T10:00:00Z', '2026-12-02T10:00:01Z', '2026-11-30T10:00:00Z', '2026-11', 'a second past 32 days: the Nov 30 anniversary counts'),
  ('2026-10-10T00:00:00Z', '2026-10-20T00:00:00Z', '2026-10-15T00:00:00Z', '2026-10', 'a short period is one allowance month'),
  ('2026-10-20T00:00:00Z', '2026-10-20T00:00:00Z', '2026-10-25T00:00:00Z', '2026-10', 'an empty period is its start month'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2026-10-31T10:00:00Z', '2026-10', 'yearly: at the start'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2026-11-30T09:59:59Z', '2026-10', 'yearly: a second before the first anniversary'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2026-11-30T10:00:00Z', '2026-11', 'yearly: Oct 31 to Nov 30 clamped'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2026-12-31T09:59:59Z', '2026-11', 'yearly: a second before Dec 31'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2026-12-31T10:00:00Z', '2026-12', 'yearly: back to day 31, counted from the start'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2027-02-28T10:00:00Z', '2027-02', 'yearly: Feb 28 clamped'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2027-03-28T10:00:00Z', '2027-02', 'yearly: day 28 of March is before the anniversary'),
  ('2026-10-31T10:00:00Z', '2027-10-31T10:00:00Z', '2027-03-31T10:00:00Z', '2027-03', 'yearly: Mar 31 back to day 31'),
  ('2027-10-31T10:00:00Z', '2028-10-31T10:00:00Z', '2028-02-29T10:00:00Z', '2028-02', 'yearly, leap: Feb 29 clamped'),
  ('2027-10-31T10:00:00Z', '2028-10-31T10:00:00Z', '2028-02-29T09:59:59Z', '2028-01', 'yearly, leap: a second before Feb 29'),
  ('2028-02-29T10:00:00Z', '2029-02-28T10:00:00Z', '2028-03-29T10:00:00Z', '2028-03', 'yearly from Feb 29: day 29 kept'),
  ('2028-02-29T10:00:00Z', '2029-02-28T10:00:00Z', '2029-01-29T10:00:00Z', '2029-01', 'yearly from Feb 29: last anniversary before the end'),
  ('2028-02-29T10:00:00Z', '2029-02-28T10:00:00Z', '2029-02-28T10:00:00Z', '2029-01', 'yearly from Feb 29: at the end, capped'),
  ('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2027-09-05T00:00:00Z', '2027-09', 'yearly: last anniversary'),
  ('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2027-10-04T23:59:59Z', '2027-09', 'yearly: last second'),
  ('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2027-09', 'yearly: at the end, no renewal written, capped'),
  ('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2029-01-01T00:00:00Z', '2027-09', 'yearly: long past the end, capped'),
  ('2026-10-05T00:00:00Z', '2027-10-05T00:00:00Z', '2026-09-01T00:00:00Z', '2026-10', 'yearly: a clock before the start stays on the start'),
  ('2026-12-15T00:00:00Z', '2027-12-15T00:00:00Z', '2027-01-15T00:00:00Z', '2027-01', 'yearly across New Year'),
  ('2026-10-15T23:30:00Z', '2027-10-15T23:30:00Z', '2026-11-15T23:29:59Z', '2026-10', 'yearly: time of day counts'),
  ('2026-10-15T00:00:00Z', '2026-12-15T00:00:00Z', '2026-11-20T00:00:00Z', '2026-11', 'a cut-short period (cancel_at) still has anniversaries'),
  ('2026-10-15T00:00:00Z', '2026-12-15T00:00:00Z', '2026-12-20T00:00:00Z', '2026-11', 'a cut-short period is capped at its last anniversary'),
  ('2026-10-31T10:00:00Z', '2027-03-15T10:00:00Z', '2027-03-01T00:00:00Z', '2027-02', 'a yearly plan cut short: the clamped anniversary still counts'),
  ('2026-10-31T10:00:00Z', '2027-03-15T10:00:00Z', '2027-06-01T00:00:00Z', '2027-02', 'a yearly plan cut short: Mar 31 is past its end, capped at Feb 28')
-- AGREEMENT CASES END
;

select is(
  (select count(*)::int from agreement where public.ai_allowance_month(period_start::timestamptz, period_end::timestamptz, at::timestamptz) is distinct from expected),
  0,
  'ai_allowance_month gives the expected key for every case of the table'
);
select is(
  (select coalesce(string_agg(label, '; '), '') from agreement
    where public.ai_allowance_month(period_start::timestamptz, period_end::timestamptz, at::timestamptz) is distinct from expected),
  '',
  'no case disagrees (lists any that do)'
);
select ok((select count(*) from agreement) >= 30, 'the table has its cases');

set local timezone = 'America/New_York';
select is(
  public.ai_allowance_month('2026-11-01T00:30:00Z', '2026-12-01T00:30:00Z', '2026-11-15T00:00:00Z'),
  '2026-11',
  'the key is UTC whatever the session time zone (Oct 31 evening in New York)'
);
reset timezone;

select throws_ok(
  $$ select public.ai_allowance_month(null, null, null) $$,
  '22004', null,
  'a null clock is refused'
);
select is(
  public.ai_allowance_month(null, null),
  to_char(now() at time zone 'utc', 'YYYY-MM'),
  'the clock defaults to now()'
);

-- M1: one payment, one allowance --------------------------------------------------------------
create function pg_temp.key(p_user uuid, p_now timestamptz) returns text language sql as $$
  select public.ai_allowance_month(s.ai_period_start, s.ai_period_end, p_now)
  from public.subscriptions s where s.user_id = p_user
$$;

update public.subscriptions set
  id = 'sub_029_a', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 2500,
  ai_period_start = '2026-10-31T10:00:00Z', ai_period_end = '2026-11-30T10:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000291';

select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000291', pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-10-31T20:00:00Z'), 2500)),
  '(t,0,2500)',
  'Oct 31: the whole allowance can be spent'
);
select is(
  pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-11-01T01:00:00Z'),
  '2026-10',
  'Nov 1: the same key as Oct 31'
);
select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000291', pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-11-01T01:00:00Z'), 1)),
  '(f,0,2500)',
  'Nov 1: nothing is left: one payment funded one allowance'
);
select is(
  pg_temp.key('00000000-0000-0000-0000-000000000291', '2027-01-15T00:00:00Z'),
  '2026-10',
  'a period that ended with no webhook keeps its key: no fresh bucket'
);

-- The renewal arrives: a new period, a new key, a fresh allowance.
update public.subscriptions
  set ai_period_start = '2026-11-30T10:00:00Z', ai_period_end = '2026-12-31T10:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000291';
select is(
  pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-12-01T00:00:00Z'),
  '2026-11',
  'the renewal moves the key, also across the calendar month (Dec 1 stays on the Nov 30 period)'
);
select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000291', pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-12-01T00:00:00Z'), 100)),
  '(t,2400,2500)',
  'the renewal resets: the new key has the whole allowance'
);

-- The stored period never moves backwards.
update public.subscriptions
  set ai_period_start = '2026-10-31T10:00:00Z', ai_period_end = '2026-11-30T10:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000291';
select is(
  (select ai_period_start from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000291'),
  '2026-11-30T10:00:00Z'::timestamptz,
  'a stale write for the same subscription id does not move the start back'
);
select is(
  (select ai_period_end from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000291'),
  '2026-12-31T10:00:00Z'::timestamptz,
  'nor the end'
);
update public.subscriptions set ai_period_start = null, ai_period_end = null
where user_id = '00000000-0000-0000-0000-000000000291';
select is(
  (select ai_period_start from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000291'),
  '2026-11-30T10:00:00Z'::timestamptz,
  'a write with no period for the same subscription id keeps the stored one'
);
update public.subscriptions set ai_period_end = '2026-12-20T10:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000291';
select is(
  (select ai_period_end from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000291'),
  '2026-12-20T10:00:00Z'::timestamptz,
  'the same start with a new end is taken (cancel_at cuts a period short)'
);
insert into public.subscriptions (id, user_id, tier, status, ai_mode, ai_monthly_credits, ai_period_start, ai_period_end)
values ('sub_029_a2', '00000000-0000-0000-0000-000000000291', 'pro_ai', 'active', 'managed', 2500, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')
on conflict (user_id) do update set
  id = excluded.id, ai_period_start = excluded.ai_period_start, ai_period_end = excluded.ai_period_end;
select is(
  (select ai_period_start from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000291'),
  '2026-09-01T00:00:00Z'::timestamptz,
  'a different subscription taking over the row brings its own period (the upsert path)'
);

-- Plan changes ------------------------------------------------------------------------------------
-- Monthly to yearly restarts the period. In the same calendar month the key stays, so the usage
-- carries over: nothing extra is granted.
update public.subscriptions set
  id = 'sub_029_a3', ai_period_start = '2026-11-05T00:00:00Z', ai_period_end = '2026-12-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000291';
update public.subscriptions set
  ai_period_start = '2026-11-20T00:00:00Z', ai_period_end = '2027-11-20T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000291';
select is(
  pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-11-20T01:00:00Z'),
  '2026-11',
  'monthly to yearly in the period''s start month: same key'
);
-- Cancelling and resubscribing in the same calendar month: a new id, the same key, usage carried.
insert into public.subscriptions (id, user_id, tier, status, ai_mode, ai_monthly_credits, ai_period_start, ai_period_end)
values ('sub_029_a4', '00000000-0000-0000-0000-000000000291', 'pro_ai', 'active', 'managed', 2500, '2026-11-25T00:00:00Z', '2026-12-25T00:00:00Z')
on conflict (user_id) do update set
  id = excluded.id, ai_period_start = excluded.ai_period_start, ai_period_end = excluded.ai_period_end;
select is(
  pg_temp.key('00000000-0000-0000-0000-000000000291', '2026-12-10T00:00:00Z'),
  '2026-11',
  'resubscribing in the same calendar month: same key'
);
select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits('00000000-0000-0000-0000-000000000291', '2026-11', 2401)),
  '(f,2400,2500)',
  'so the usage carries over (conservative and accepted)'
);

-- A yearly plan: an allowance per anniversary -----------------------------------------------------
update public.subscriptions set
  id = 'sub_029_b', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 2684,
  ai_period_start = '2026-10-31T10:00:00Z', ai_period_end = '2027-10-31T10:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000292';

select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000292', pg_temp.key('00000000-0000-0000-0000-000000000292', '2026-11-01T00:00:00Z'), 2684)),
  '(t,0,2684)',
  'yearly: the first allowance month can be spent, on the calendar 1st too'
);
select is(
  (select allowed from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000292', pg_temp.key('00000000-0000-0000-0000-000000000292', '2026-11-30T09:00:00Z'), 1)),
  false,
  'yearly: still the same allowance month up to the anniversary'
);
select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000292', pg_temp.key('00000000-0000-0000-0000-000000000292', '2026-11-30T10:00:00Z'), 10)),
  '(t,2674,2684)',
  'yearly: the anniversary resets'
);

-- The freeze: the key of the OLD period -----------------------------------------------------------
update public.subscriptions set
  id = 'sub_029_c', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000,
  ai_period_start = '2026-10-15T00:00:00Z', ai_period_end = '2026-11-15T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000293';
insert into public.ai_usage (user_id, month, credits_used) values
  ('00000000-0000-0000-0000-000000000293', '2026-10', 600),
  ('00000000-0000-0000-0000-000000000293', '2026-11', 700);
-- Bought before the period's end (an explicit created_at: the default would make these hold packs
-- once the clock passes Nov 15).
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-000000000293', '2026-10', 300, 'cs_029_c_old', '2026-10-20T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000293', '2026-11', 200, 'cs_029_c_new', '2026-10-20T00:00:00Z');

-- A renewal that went straight to past_due: a new period and an allowance of 0 in one write.
update public.subscriptions set
  status = 'past_due', ai_monthly_credits = 0,
  ai_period_start = '2026-11-15T00:00:00Z', ai_period_end = '2026-12-15T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000293';
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000293' and month = '2026-10'),
  600,
  'a new period and an allowance of 0 written together freeze on the old key''s row'
);
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000293' and month = '2026-11'),
  null::integer,
  'and leave the new key''s row alone'
);
select is(
  (select row(allowed, remaining, cap)::text from public.ai_reserve_credits(
    '00000000-0000-0000-0000-000000000293', '2026-11', 1)),
  '(f,0,200)',
  'a renewal into past_due gives no fresh credits: only the new bucket''s pack, already used up by its counter'
);
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000293', '2026-12'),
  0,
  'past_due with the period advanced: an empty bucket has a cap of 0'
);
-- The payment recovers: the allowance comes back on the same new period.
update public.subscriptions set status = 'active', ai_monthly_credits = 1000
where user_id = '00000000-0000-0000-0000-000000000293';
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000293', '2026-11'),
  1200,
  'recovered: allowance plus the bucket''s pack'
);

-- Only the allowance written (invoice.payment_failed): the period stays, the freeze is on its key.
update public.subscriptions set
  id = 'sub_029_d', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000,
  ai_period_start = '2026-10-15T00:00:00Z', ai_period_end = '2027-10-15T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000294';
create temporary table yearly_key as
  select public.ai_allowance_month('2026-10-15T00:00:00Z', '2027-10-15T00:00:00Z', now()) as k;
insert into public.ai_usage (user_id, month, credits_used)
  select '00000000-0000-0000-0000-000000000294', k, 400 from yearly_key;
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
where user_id = '00000000-0000-0000-0000-000000000294';
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000294' and month = (select k from yearly_key)),
  400,
  'an allowance of 0 written alone freezes on the key of the stored period at the clock'
);

-- Null period: the calendar month, as 027 did.
update public.subscriptions set
  id = 'sub_029_e', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
where user_id = '00000000-0000-0000-0000-000000000295';
insert into public.ai_usage (user_id, month, credits_used) values
  ('00000000-0000-0000-0000-000000000295', to_char(now() at time zone 'utc', 'YYYY-MM'), 250);
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
where user_id = '00000000-0000-0000-0000-000000000295';
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000295'),
  250,
  'with no stored period the freeze uses the UTC calendar month'
);

-- L7: settle stops at the cap ---------------------------------------------------------------------
update public.subscriptions set
  id = 'sub_029_f', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000
where user_id = '00000000-0000-0000-0000-000000000296';
insert into public.ai_usage (user_id, month, credits_used)
  values ('00000000-0000-0000-0000-000000000296', '2026-10', 900);

select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 50),
  950,
  'under the cap: a positive delta is added in full'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 50),
  1000,
  'landing on the cap: added in full'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 1),
  1000,
  'at the cap: a positive delta adds nothing'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', -100),
  900,
  'a negative delta lowers as before'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 500),
  1000,
  'over the cap: stops at the cap'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', -2000),
  0,
  'a negative delta floors at 0 as before'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 2147483647),
  1000,
  'a huge delta does not overflow'
);

-- With packs: the cap includes unrevoked packs and leaves out revoked ones.
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at) values
  ('00000000-0000-0000-0000-000000000296', '2026-10', 300, 'cs_029_f_ok', null),
  ('00000000-0000-0000-0000-000000000296', '2026-10', 9999, 'cs_029_f_revoked', now());
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 150),
  1150,
  'a pack raises what a settlement may reach'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 1000),
  1300,
  'stops at allowance + the pack; a revoked pack does not count'
);

-- Already over the cap (the pack was revoked afterwards).
update public.ai_credit_purchases set revoked_at = now() where stripe_checkout_session_id = 'cs_029_f_ok';
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000296', '2026-10'),
  1000,
  'the cap fell under the usage'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 5),
  1300,
  'a positive delta does not lower a value already over the cap, and adds nothing'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', -5),
  1295,
  'a negative delta still lowers a value over the cap'
);

-- Frozen: the allowance is gone, allowance_spent and packs remain.
update public.ai_credit_purchases set revoked_at = null where stripe_checkout_session_id = 'cs_029_f_ok';
update public.ai_usage set credits_used = 1000
  where user_id = '00000000-0000-0000-0000-000000000296' and month = '2026-10';
update public.subscriptions set
  status = 'past_due', ai_monthly_credits = 0,
  ai_period_start = '2026-10-01T00:00:00Z', ai_period_end = '2026-10-29T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000296';
update public.ai_usage set allowance_spent = 700
  where user_id = '00000000-0000-0000-0000-000000000296' and month = '2026-10';
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000296', '2026-10'),
  1000,
  'frozen: the cap is allowance_spent + the pack'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', 50),
  1000,
  'frozen: a settlement stays within it'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2026-10', -400),
  600,
  'frozen: a negative settlement lowers usage'
);
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000296' and month = '2026-10'),
  600,
  'and the clamp trigger still pulls allowance_spent down with it'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-000000000296', '2030-01', 5),
  null::integer,
  'no usage row: null, and none is created'
);
select is(
  (select count(*)::int from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000296' and month = '2030-01'),
  0,
  'none was created'
);
select is(
  public.ai_settle_credits('00000000-0000-0000-0000-0000000000f0', '2026-10', 5),
  null::integer,
  'a user with no row at all: null'
);

-- The settle fails closed for an entitled-but-not-active row with no packs.
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000296', '2031-01'),
  0,
  'a bucket with nothing in it has a cap of 0 for a past_due row'
);

-- The cap is one rule -------------------------------------------------------------------------
update public.subscriptions set
  id = 'sub_029_g', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 500
where user_id = '00000000-0000-0000-0000-000000000297';
insert into public.ai_usage (user_id, month, credits_used)
  values ('00000000-0000-0000-0000-000000000297', '2026-10', 490);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at) values
  ('00000000-0000-0000-0000-000000000297', '2026-10', 20, 'cs_029_g_ok', null),
  ('00000000-0000-0000-0000-000000000297', '2026-10', 77, 'cs_029_g_revoked', now());
select is(
  (select cap from public.ai_reserve_credits('00000000-0000-0000-0000-000000000297', '2026-10', 1)),
  public.ai_credit_cap('00000000-0000-0000-0000-000000000297', '2026-10'),
  'ai_reserve_credits reports the cap of ai_credit_cap'
);
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000297', '2026-10'),
  520,
  'allowance + the unrevoked pack'
);
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000297', '2026-11'),
  500,
  'a pack counts only on its own key'
);
select is(public.ai_credit_cap('00000000-0000-0000-0000-0000000000f0', '2026-10'), 0, 'a user with no row has a cap of 0');

-- Tier, mode and status gate the allowance, as in 027.
update public.subscriptions set tier = 'pro' where user_id = '00000000-0000-0000-0000-000000000297';
select is(public.ai_credit_cap('00000000-0000-0000-0000-000000000297', '2026-11'), 0, 'not pro_ai: no allowance');
update public.subscriptions set tier = 'pro_ai', ai_mode = 'byok' where user_id = '00000000-0000-0000-0000-000000000297';
select is(public.ai_credit_cap('00000000-0000-0000-0000-000000000297', '2026-11'), 0, 'own key: no allowance');
update public.subscriptions set ai_mode = 'managed', status = 'trialing' where user_id = '00000000-0000-0000-0000-000000000297';
select is(public.ai_credit_cap('00000000-0000-0000-0000-000000000297', '2026-11'), 0, 'trialing: no allowance');

-- ai_credits_exhausted takes the new key and stays never stricter than the reservation (the full
-- grid is in the 028 file).
update public.subscriptions set status = 'active' where user_id = '00000000-0000-0000-0000-000000000297';
insert into public.ai_usage (user_id, month, credits_used)
  values ('00000000-0000-0000-0000-000000000297', '2026-12', 500);
select is(
  public.ai_credits_exhausted('00000000-0000-0000-0000-000000000297', '2026-12'),
  true,
  'exhausted on the key whose usage reached the allowance'
);
select is(
  public.ai_credits_exhausted('00000000-0000-0000-0000-000000000297', '2027-01'),
  false,
  'not exhausted on a later key: the next period is fresh'
);
select is(
  (select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-000000000297', '2026-12', 1)),
  false,
  'the reservation agrees with exhausted'
);

-- Packs bought while a renewal awaits payment -------------------------------------------------------
-- Period Oct 5 to Nov 5, renewal not paid: the row keeps its period, allowance 1000, 900 used.
update public.subscriptions set
  id = 'sub_029_h', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 1000,
  ai_period_start = '2026-10-05T00:00:00Z', ai_period_end = '2026-11-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000298';
insert into public.ai_usage (user_id, month, credits_used)
  values ('00000000-0000-0000-0000-000000000298', '2026-10', 900);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-000000000298', '2026-10', 200, 'cs_029_h_before', '2026-11-04T00:00:00Z'),
  ('00000000-0000-0000-0000-000000000298', '2026-10', 300, 'cs_029_h_hold1', '2026-11-05T00:10:00Z'),
  ('00000000-0000-0000-0000-000000000298', '2026-10', 400, 'cs_029_h_hold2', '2026-11-05T00:20:00Z');
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at, revoked_at) values
  ('00000000-0000-0000-0000-000000000298', '2026-10', 500, 'cs_029_h_revoked', '2026-11-05T00:30:00Z', now());

select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000298', '2026-10'),
  1900,
  'during the hold the packs count on the old key: spendable at once'
);
-- Spend into the packs during the hold: cap 1900, used 900 + 800 = 1700, 200 left.
select is(
  (select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-000000000298', '2026-10', 800)),
  true,
  'during the hold a pack can be spent'
);

-- Paid: the period advances.
update public.subscriptions set
  ai_period_start = '2026-11-05T00:00:00Z', ai_period_end = '2026-12-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000298';
select is(
  (select row(month, credits)::text from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_h_hold2'),
  '(2026-11,200)',
  'the newest hold pack moves with its unspent part only'
);
select is(
  (select row(month, credits)::text from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_h_hold1'),
  '(2026-10,300)',
  'a hold pack with nothing unspent stays on the old key'
);
select is(
  (select row(month, credits)::text from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_h_before'),
  '(2026-10,200)',
  'a pack bought before the period ended ends with it'
);
select is(
  (select row(month, credits)::text from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_h_revoked'),
  '(2026-10,500)',
  'a revoked pack does not move'
);
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000298', '2026-11'),
  1200,
  'the new key has the allowance plus the unspent 200, so nothing spent came back'
);

-- Running the same write again moves nothing.
update public.subscriptions set
  ai_period_start = '2026-11-05T00:00:00Z', ai_period_end = '2026-12-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000298';
select is(
  (select credits from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_h_hold2'),
  200,
  'a redelivered write moves nothing'
);

-- A renewal that failed: allowance frozen first, then the period advances on recovery. Only the
-- old key's real headroom moves.
update public.subscriptions set
  status = 'past_due', ai_monthly_credits = 0
where user_id = '00000000-0000-0000-0000-000000000298';
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000298', '2026-11'),
  200,
  'past_due on the held period: nothing used yet, so only the pack'
);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-000000000298', '2026-11', 50, 'cs_029_h_dunning', '2026-12-06T00:00:00Z');
update public.subscriptions set
  status = 'active', ai_monthly_credits = 1000,
  ai_period_start = '2026-12-05T00:00:00Z', ai_period_end = '2027-01-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000298';
select is(
  (select row(month, credits)::text from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_h_dunning'),
  '(2026-12,50)',
  'recovered: a pack bought during dunning moves to the new key'
);
select is(
  public.ai_credit_cap('00000000-0000-0000-0000-000000000298', '2026-12'),
  1050,
  'recovered: the full allowance and the carried pack, one fresh bucket'
);

-- Carrying packs, one case per user. Dates are fixed and in the past, so keys don't follow the clock:
-- a yearly period that has ended is capped at its last anniversary.
create function pg_temp.pack(p_session text) returns text language sql as $$
  select row(p.month, p.credits, p.carried_from_month)::text
  from public.ai_credit_purchases p where p.stripe_checkout_session_id = p_session
$$;
create function pg_temp.start(p_user uuid, p_id text, p_start timestamptz, p_end timestamptz, p_allowance integer) returns void language sql as $$
  update public.subscriptions set
    id = p_id, tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = p_allowance,
    ai_period_start = p_start, ai_period_end = p_end
  where user_id = p_user
$$;

-- An early restart on the same id (monthly to yearly): a pack bought days earlier isn't forfeited.
select pg_temp.start('00000000-0000-0000-0000-0000000002a1', 'sub_029_i', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
insert into public.ai_usage (user_id, month, credits_used) values ('00000000-0000-0000-0000-0000000002a1', '2024-10', 1100);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a1', '2024-10', 300, 'cs_029_i', '2024-10-20T00:00:00Z');
update public.subscriptions set ai_period_start = '2024-11-01T00:00:00Z', ai_period_end = '2025-11-01T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a1';
select is(pg_temp.pack('cs_029_i'), '(2025-10,200,2024-10)',
  'cut short on the same id: an older pack carries its unspent part, and the row says where from');
update public.subscriptions set ai_period_start = '2024-11-01T00:00:00Z', ai_period_end = '2025-11-01T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a1';
select is(pg_temp.pack('cs_029_i'), '(2025-10,200,2024-10)', 'the same write again does not carry twice');
-- The carried row, then a dispute and its restore.
select is(public.ai_credit_cap('00000000-0000-0000-0000-0000000002a1', '2025-10'), 1200, 'allowance + the carried part');
update public.ai_credit_purchases set revoked_at = now() where stripe_checkout_session_id = 'cs_029_i';
select is(public.ai_credit_cap('00000000-0000-0000-0000-0000000002a1', '2025-10'), 1000, 'a dispute on a lowered row takes off what it holds');
update public.ai_credit_purchases set revoked_at = null where stripe_checkout_session_id = 'cs_029_i';
select is(public.ai_credit_cap('00000000-0000-0000-0000-0000000002a1', '2025-10'), 1200, 'a restore gives back the lowered figure, not the original');
-- ai_credits_exhausted and the reservation on both keys after the carry.
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000002a1', '2024-10'), true, 'old key after a carry: exhausted (no pack row left, usage over the allowance)');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000002a1', '2024-10', 1)), false, 'old key after a carry: the reservation agrees');
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000002a1', '2025-10'), false, 'new key after a carry: not exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000002a1', '2025-10', 1)), true, 'new key after a carry: the reservation agrees');

-- A restart in the same calendar month keeps the key: nothing moves.
select pg_temp.start('00000000-0000-0000-0000-0000000002a2', 'sub_029_j', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a2', '2024-10', 300, 'cs_029_j', '2024-10-06T00:00:00Z');
update public.subscriptions set ai_period_start = '2024-10-20T00:00:00Z', ai_period_end = '2024-11-20T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a2';
select is(pg_temp.pack('cs_029_j'), '(2024-10,300,)', 'a new period on the same key moves nothing');

-- As service_role, the webhook's role; one write setting a new period and allowance 0, with a hold pack.
select pg_temp.start('00000000-0000-0000-0000-0000000002a3', 'sub_029_k', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
insert into public.ai_usage (user_id, month, credits_used) values ('00000000-0000-0000-0000-0000000002a3', '2024-10', 900);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a3', '2024-10', 400, 'cs_029_k', '2024-11-05T00:10:00Z');
set local role service_role;
update public.subscriptions set
  status = 'past_due', ai_monthly_credits = 0,
  ai_period_start = '2024-11-05T00:00:00Z', ai_period_end = '2024-12-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a3';
reset role;
select is(pg_temp.pack('cs_029_k'), '(2024-11,400,2024-10)', 'as service_role, one write with a new period and allowance 0: the hold pack moves');
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-0000000002a3' and month = '2024-10'),
  900,
  'and the freeze still records the old key'
);
select is(public.ai_credit_cap('00000000-0000-0000-0000-0000000002a3', '2024-11'), 400, 'the new key holds the pack and no allowance');

-- Nothing left under the old key's cap: the pack stays as it is.
select pg_temp.start('00000000-0000-0000-0000-0000000002a4', 'sub_029_l', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
insert into public.ai_usage (user_id, month, credits_used) values ('00000000-0000-0000-0000-0000000002a4', '2024-10', 1400);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a4', '2024-10', 400, 'cs_029_l', '2024-11-05T00:10:00Z');
update public.subscriptions set ai_period_start = '2024-11-05T00:00:00Z', ai_period_end = '2024-12-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a4';
select is(pg_temp.pack('cs_029_l'), '(2024-10,400,)', 'nothing unspent: the pack stays, not marked as carried');

-- A backward write with a hold pack: refused by the BEFORE trigger, so nothing carries.
select pg_temp.start('00000000-0000-0000-0000-0000000002a5', 'sub_029_m', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a5', '2024-10', 400, 'cs_029_m', '2024-11-05T00:10:00Z');
update public.subscriptions set ai_period_start = '2024-09-05T00:00:00Z', ai_period_end = '2024-10-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a5';
select is(pg_temp.pack('cs_029_m'), '(2024-10,400,)', 'a backward write moves no pack');
select is(
  (select ai_period_start from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000002a5'),
  '2024-10-05T00:00:00Z'::timestamptz,
  'and the period stayed'
);

-- A new subscription id taking over the row, with a hold pack and a pack bought before a cut-short end.
select pg_temp.start('00000000-0000-0000-0000-0000000002a6', 'sub_029_n', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a6', '2024-10', 400, 'cs_029_n1', '2024-10-20T00:00:00Z');
insert into public.subscriptions (id, user_id, tier, status, ai_mode, ai_monthly_credits, ai_period_start, ai_period_end)
values ('sub_029_n2', '00000000-0000-0000-0000-0000000002a6', 'pro_ai', 'active', 'managed', 1000, '2024-11-02T00:00:00Z', '2024-12-02T00:00:00Z')
on conflict (user_id) do update set
  id = excluded.id, ai_period_start = excluded.ai_period_start, ai_period_end = excluded.ai_period_end;
select is(pg_temp.pack('cs_029_n1'), '(2024-11,400,2024-10)', 'a new id before the old end: the older pack carries');
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a6', '2024-11', 150, 'cs_029_n3', '2024-12-02T00:10:00Z');
insert into public.subscriptions (id, user_id, tier, status, ai_mode, ai_monthly_credits, ai_period_start, ai_period_end)
values ('sub_029_n4', '00000000-0000-0000-0000-0000000002a6', 'pro_ai', 'active', 'managed', 1000, '2025-01-10T00:00:00Z', '2025-02-10T00:00:00Z')
on conflict (user_id) do update set
  id = excluded.id, ai_period_start = excluded.ai_period_start, ai_period_end = excluded.ai_period_end;
select is(pg_temp.pack('cs_029_n3'), '(2025-01,150,2024-11)', 'a new id after the old end: a pack bought after that end carries');
select is(pg_temp.pack('cs_029_n1'), '(2024-11,400,2024-10)', 'and a pack from before a full period stays behind');

-- A yearly renewal: carried from the capped last anniversary.
select pg_temp.start('00000000-0000-0000-0000-0000000002a7', 'sub_029_o', '2024-10-05T00:00:00Z', '2025-10-05T00:00:00Z', 1000);
insert into public.ai_usage (user_id, month, credits_used) values ('00000000-0000-0000-0000-0000000002a7', '2025-09', 800);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a7', '2025-09', 500, 'cs_029_o', '2025-10-05T00:10:00Z');
update public.subscriptions set ai_period_start = '2025-10-05T00:00:00Z', ai_period_end = '2025-11-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a7';
select is(pg_temp.pack('cs_029_o'), '(2025-10,500,2025-09)', 'a yearly renewal carries from the last anniversary''s key');

-- No usage row on the old key: everything is unspent.
select pg_temp.start('00000000-0000-0000-0000-0000000002a8', 'sub_029_p', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 0);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000002a8', '2024-10', 500, 'cs_029_p', '2024-11-05T00:10:00Z');
update public.subscriptions set ai_period_start = '2024-11-05T00:00:00Z', ai_period_end = '2024-12-05T00:00:00Z'
where user_id = '00000000-0000-0000-0000-0000000002a8';
select is(pg_temp.pack('cs_029_p'), '(2024-11,500,2024-10)', 'no usage row: the whole pack carries');

-- Granting a pack ---------------------------------------------------------------------------------
select pg_temp.start('00000000-0000-0000-0000-0000000002a9', 'sub_029_q', '2024-10-05T00:00:00Z', '2024-11-05T00:00:00Z', 1000);
select is(
  public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002a9', 'cs_029_q1', 820, false),
  true,
  'a grant inserts'
);
select is(pg_temp.pack('cs_029_q1'), '(2024-10,820,)', 'on the key the buyer is metered on, also when the stored period has ended');
select is(
  public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002a9', 'cs_029_q1', 9999, false),
  false,
  'a redelivered grant is a no-op'
);
select is(pg_temp.pack('cs_029_q1'), '(2024-10,820,)', 'and changes nothing');
select is(
  public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002a9', 'cs_029_q2', 820, true),
  true,
  'a revoked grant inserts too'
);
select isnt(
  (select revoked_at from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_q2'),
  null::timestamptz,
  'already revoked'
);
select is(
  public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002a9', 'cs_029_q2', 820, false),
  false,
  'a later grant finds the row'
);
select isnt(
  (select revoked_at from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_q2'),
  null::timestamptz,
  'and leaves it revoked'
);
delete from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000002b1';
select is(
  public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002b1', 'cs_029_r', 100, false),
  true,
  'no subscription row: still granted'
);
select is(
  (select month from public.ai_credit_purchases where stripe_checkout_session_id = 'cs_029_r'),
  to_char(now() at time zone 'utc', 'YYYY-MM'),
  'on the UTC calendar month'
);
select throws_ok(
  $$ select public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002a9', 'cs_029_q3', -1, false) $$,
  '22023', null, 'negative credits are refused'
);
select throws_ok(
  $$ select public.ai_grant_credit_pack('00000000-0000-0000-0000-0000000002a9', null, 1, false) $$,
  '22004', null, 'a null session is refused'
);
select ok(
  not has_function_privilege('anon', 'public.ai_grant_credit_pack(uuid, text, integer, boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ai_grant_credit_pack(uuid, text, integer, boolean)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_grant_credit_pack(uuid, text, integer, boolean)', 'EXECUTE'),
  'only service_role can grant'
);
select ok(
  position('for share' in pg_catalog.pg_get_functiondef('public.ai_grant_credit_pack(uuid, text, integer, boolean)'::regprocedure))
    < position('insert into public.ai_credit_purchases' in pg_catalog.pg_get_functiondef('public.ai_grant_credit_pack(uuid, text, integer, boolean)'::regprocedure)),
  'ai_grant_credit_pack locks the subscriptions row before it inserts'
);

-- The new column and the pair check.
select col_is_null('public', 'ai_credit_purchases', 'carried_from_month', 'carried_from_month is nullable');
select ok(
  not has_column_privilege('authenticated', 'public.ai_credit_purchases', 'carried_from_month', 'UPDATE')
    and not has_column_privilege('anon', 'public.ai_credit_purchases', 'carried_from_month', 'UPDATE'),
  'the API roles cannot write carried_from_month'
);
select throws_ok(
  $$ update public.subscriptions set id = 'sub_029_q9', ai_period_end = null
     where user_id = '00000000-0000-0000-0000-0000000002a9' $$,
  '23514', null,
  'the period columns are both set or both null'
);

-- Service role can run the freeze path (the webhook's role) ---------------------------------------
update public.subscriptions set
  id = 'sub_029_g2', tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 500,
  ai_period_start = '2026-12-01T00:00:00Z', ai_period_end = '2027-01-01T00:00:00Z'
where user_id = '00000000-0000-0000-0000-000000000297';
set local role service_role;
update public.subscriptions set status = 'past_due', ai_monthly_credits = 0
where user_id = '00000000-0000-0000-0000-000000000297';
reset role;
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-000000000297' and month = '2026-12'),
  500,
  'the freeze runs for service_role, which may execute the key function'
);

-- A signed-in user can't write the period ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000291","role":"authenticated"}', true);
select throws_ok(
  $$ update public.subscriptions set ai_period_start = '2030-01-01T00:00:00Z' where user_id = '00000000-0000-0000-0000-000000000291' $$,
  '42501', null,
  'a signed-in user cannot write ai_period_start'
);
select throws_ok(
  $$ select public.ai_credit_cap('00000000-0000-0000-0000-000000000291', '2026-10') $$,
  '42501', null,
  'a signed-in user cannot call ai_credit_cap'
);
reset role;

select * from finish();
rollback;
