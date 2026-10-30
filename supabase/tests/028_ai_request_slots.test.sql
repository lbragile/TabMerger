-- pgTAP test for 028_ai_request_slots.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves:
--   - ai_request_slots has RLS on with no policy, nothing granted to the API roles, and indexes
--     on user_id and expires_at; the five functions are security definer with an empty
--     search_path, service role only (anon and a signed-in user get 42501), acquire and
--     release run with lock_timeout = 1s, and pg_cron purges every 10 minutes.
--   - ai_slot_acquire() hands out at most p_max leases per user, returns NULL (writing nothing)
--     when they are taken, ignores and deletes expired leases, and counts users separately.
--   - ai_slot_release() deletes only the caller's own lease, once.
--   - ai_slot_purge() deletes only leases that ended over an hour ago, oldest first, at most
--     p_limit, and refuses a bad limit.
--   - ai_credits_exhausted() is never stricter than ai_reserve_credits() as 027 defines it
--     (027_ai_credit_revocation_and_past_due_allowance.sql: allowance only for `active`,
--     greatest(allowance, allowance_spent) + unrevoked packs, CHECK 0 <= allowance_spent <=
--     credits_used). Named cases (past_due with allowance_spent, a revoked pack, allowance_spent
--     above the allowance, trialing and past_due with an allowance on the row, BYOK, free), then
--     a grid over status x tier x mode x allowance x used x allowance_spent x packs in which no
--     combination is both "exhausted" and allowed by a 1-credit reservation (each reservation
--     rolled back). If 027's allowance rule and this function drift apart, the grid fails.
--   - rate_limit_peek() answers like rate_limit_take() would for a full window, counts nothing,
--     refuses a duplicate window length like take, and is the lenient side for a stored window
--     newer than the clock (take refuses that, peek reports room).
--   - Bad input to every function is refused.
--
-- Not covered here: two callers racing on one user's advisory lock, the lock_timeout firing, an
-- expired lease held by another transaction being skipped, and the READ COMMITTED guard (25001)
-- all need a second session or a fresh transaction (one pgTAP transaction never blocks on its own
-- locks, and its isolation level is fixed). Check those by hand with two psql sessions.
--
-- Everything runs in one transaction that is rolled back.

begin;
select plan(84);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000028a1', 'slots-a@example.test'),
  ('00000000-0000-0000-0000-0000000028a2', 'slots-b@example.test'),
  ('00000000-0000-0000-0000-0000000028c1', 'credits-active@example.test'),
  ('00000000-0000-0000-0000-0000000028c2', 'credits-pastdue@example.test'),
  ('00000000-0000-0000-0000-0000000028c3', 'credits-recovered@example.test'),
  ('00000000-0000-0000-0000-0000000028c4', 'credits-pack@example.test'),
  ('00000000-0000-0000-0000-0000000028c5', 'credits-byok@example.test'),
  ('00000000-0000-0000-0000-0000000028c6', 'credits-free@example.test'),
  ('00000000-0000-0000-0000-0000000028c7', 'credits-trialing@example.test'),
  ('00000000-0000-0000-0000-0000000028c8', 'credits-grid@example.test');

create temporary table t28_month on commit drop as
  select to_char(now() at time zone 'utc', 'YYYY-MM') as m;
grant select on t28_month to service_role;

-- Shape and privileges ------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.ai_request_slots'::regclass),
  'ai_request_slots has row level security on'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'ai_request_slots'),
  0,
  'ai_request_slots has no policy'
);
select ok(
  not has_table_privilege('anon', 'public.ai_request_slots', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_request_slots', 'SELECT')
    and not has_table_privilege('authenticated', 'public.ai_request_slots', 'INSERT')
    and not has_table_privilege('authenticated', 'public.ai_request_slots', 'DELETE'),
  'the API roles hold nothing on ai_request_slots'
);
select is(
  pg_catalog.pg_get_indexdef('public.ai_request_slots_user_id_idx'::regclass),
  'CREATE INDEX ai_request_slots_user_id_idx ON public.ai_request_slots USING btree (user_id)',
  'user_id is indexed (acquire and the foreign key)'
);
select is(
  pg_catalog.pg_get_indexdef('public.ai_request_slots_expires_at_idx'::regclass),
  'CREATE INDEX ai_request_slots_expires_at_idx ON public.ai_request_slots USING btree (expires_at)',
  'expires_at is indexed (purge)'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_catalog.pg_proc
    where oid in (
      'public.ai_slot_acquire(uuid, integer, integer)'::regprocedure,
      'public.ai_slot_release(uuid, uuid)'::regprocedure,
      'public.ai_slot_purge(integer)'::regprocedure,
      'public.ai_credits_exhausted(uuid, text)'::regprocedure,
      'public.rate_limit_peek(text, text, integer[], integer[])'::regprocedure)),
  'every 028 function is security definer with an empty search_path'
);
select ok(
  (select bool_and(proconfig @> array['lock_timeout=1s']) from pg_catalog.pg_proc
    where oid in (
      'public.ai_slot_acquire(uuid, integer, integer)'::regprocedure,
      'public.ai_slot_release(uuid, uuid)'::regprocedure)),
  'acquire and release run with lock_timeout = 1s'
);
select ok(
  has_function_privilege('service_role', 'public.ai_slot_acquire(uuid, integer, integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_slot_release(uuid, uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_slot_purge(integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.ai_credits_exhausted(uuid, text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.rate_limit_peek(text, text, integer[], integer[])', 'EXECUTE'),
  'service_role can execute every 028 function'
);
select is(
  (select count(*)::integer from pg_catalog.pg_proc p,
          pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid in (
      'public.ai_slot_acquire(uuid, integer, integer)'::regprocedure,
      'public.ai_slot_release(uuid, uuid)'::regprocedure,
      'public.ai_slot_purge(integer)'::regprocedure,
      'public.ai_credits_exhausted(uuid, text)'::regprocedure,
      'public.rate_limit_peek(text, text, integer[], integer[])'::regprocedure)
      and a.grantee = 0),
  0,
  'PUBLIC can execute none of them'
);
select is(
  (select row(schedule, command, active)::text from cron.job where jobname = 'ai-slot-purge'),
  '("*/10 * * * *","select public.ai_slot_purge(5000)",t)',
  'pg_cron purges expired slots every 10 minutes in batches of 5000'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028a1';
select throws_ok($$ select public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 60) $$, '42501', null, 'a signed-in user cannot acquire a slot');
select throws_ok($$ select public.ai_slot_release('00000000-0000-0000-0000-0000000028a1', gen_random_uuid()) $$, '42501', null, 'a signed-in user cannot release a slot');
select throws_ok($$ select public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028a1', '2026-10') $$, '42501', null, 'a signed-in user cannot read the exhaustion check');
select throws_ok($$ select public.ai_slot_purge(10) $$, '42501', null, 'a signed-in user cannot purge');
reset role;
set local role anon;
select throws_ok($$ select public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 60) $$, '42501', null, 'anon cannot acquire a slot');
reset role;

-- Acquire and release -------------------------------------------------------------------------
create temporary table t28_slots (n integer, id uuid) on commit drop;
grant select, insert on t28_slots to service_role;
set local role service_role;
insert into t28_slots
  select n, public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 300)
  from generate_series(1, 4) n;
reset role;

select is(
  (select count(*)::integer from t28_slots where n <= 3 and id is not null),
  3,
  'the first three acquires under a cap of 3 get a slot'
);
select is((select id from t28_slots where n = 4), null, 'the fourth gets NULL');
select is(
  (select count(*)::integer from public.ai_request_slots where user_id = '00000000-0000-0000-0000-0000000028a1'),
  3,
  'a refused acquire writes nothing'
);
select ok(
  (select bool_and(expires_at > now() + interval '299 seconds' and expires_at < clock_timestamp() + interval '301 seconds')
     from public.ai_request_slots where user_id = '00000000-0000-0000-0000-0000000028a1'),
  'a lease ends p_lease_seconds after the acquire'
);

set local role service_role;
select isnt(
  public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a2', 3, 300),
  null,
  'another user is counted separately'
);
select is(
  public.ai_slot_release('00000000-0000-0000-0000-0000000028a2', (select id from t28_slots where n = 1)),
  false,
  'a lease cannot be released for another user'
);
select is(
  public.ai_slot_release('00000000-0000-0000-0000-0000000028a1', (select id from t28_slots where n = 1)),
  true,
  'the owner releases its lease'
);
select is(
  public.ai_slot_release('00000000-0000-0000-0000-0000000028a1', (select id from t28_slots where n = 1)),
  false,
  'releasing twice deletes nothing the second time'
);
select isnt(
  public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 300),
  null,
  'a released slot can be taken again'
);
select is(public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 300), null, 'and the cap holds again');
reset role;

-- Expired leases stop counting and are deleted by the next acquire.
update public.ai_request_slots set expires_at = clock_timestamp() - interval '1 second'
where user_id = '00000000-0000-0000-0000-0000000028a1';
set local role service_role;
select isnt(
  public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 1, 60),
  null,
  'expired leases do not count against the cap'
);
reset role;
select is(
  (select count(*)::integer from public.ai_request_slots where user_id = '00000000-0000-0000-0000-0000000028a1'),
  1,
  'the acquire deleted that user''s expired leases'
);

-- Bad input.
set local role service_role;
select throws_ok($$ select public.ai_slot_acquire(null, 3, 60) $$, '22004', null, 'NULL user refused');
select throws_ok($$ select public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 0, 60) $$, '22023', null, 'p_max 0 refused');
select throws_ok($$ select public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 101, 60) $$, '22023', null, 'p_max 101 refused');
select throws_ok($$ select public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 0) $$, '22023', null, 'lease 0 s refused');
select throws_ok($$ select public.ai_slot_acquire('00000000-0000-0000-0000-0000000028a1', 3, 3601) $$, '22023', null, 'lease 3601 s refused');
select throws_ok($$ select public.ai_slot_release(null, gen_random_uuid()) $$, '22004', null, 'release without a user refused');
select throws_ok($$ select public.ai_slot_purge(0) $$, '22023', null, 'purge limit 0 refused');
select throws_ok($$ select public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028a1', '2026-13') $$, '22023', null, 'a malformed month refused');
select throws_ok($$ select public.ai_credits_exhausted(null, '2026-10') $$, '22004', null, 'NULL user refused by the exhaustion check');
reset role;

-- Purge ---------------------------------------------------------------------------------------
delete from public.ai_request_slots;
insert into public.ai_request_slots (user_id, expires_at) values
  ('00000000-0000-0000-0000-0000000028a1', clock_timestamp() - interval '3 hours'),
  ('00000000-0000-0000-0000-0000000028a1', clock_timestamp() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000028a2', clock_timestamp() - interval '90 minutes'),
  ('00000000-0000-0000-0000-0000000028a2', clock_timestamp() - interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000028a2', clock_timestamp() + interval '5 minutes');
set local role service_role;
select is(public.ai_slot_purge(2), 2, 'the purge stops at p_limit');
reset role;
select is(
  (select count(*)::integer from public.ai_request_slots where expires_at < clock_timestamp() - interval '150 minutes'),
  0,
  'oldest first: the two oldest leases went'
);
set local role service_role;
select is(public.ai_slot_purge(100), 1, 'the next call deletes the remaining lease that ended over an hour ago');
reset role;
select is(
  (select count(*)::integer from public.ai_request_slots),
  2,
  'a lease that ended 30 minutes ago and a live one are kept'
);

-- ai_credits_exhausted() against ai_reserve_credits() -----------------------------------------
-- Each case: the check first (read-only), then a 1-credit reservation (rolled back with the rest).

-- Active managed, allowance 100.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 100
where user_id = '00000000-0000-0000-0000-0000000028c1';
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c1', (select m from t28_month)), false, 'active, no usage: not exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c1', (select m from t28_month), 1)), true, 'and the reservation is allowed');
reset role;
update public.ai_usage set credits_used = 99
where user_id = '00000000-0000-0000-0000-0000000028c1' and month = (select m from t28_month);
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c1', (select m from t28_month)), false, 'active, 1 credit left: not exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c1', (select m from t28_month), 1)), true, 'and the last credit can be reserved');
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c1', (select m from t28_month)), true, 'active, all 100 used: exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c1', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;

-- past_due after the allowance was frozen: A = 0, allowance_spent = credits_used = 50, no packs.
update public.subscriptions set tier = 'pro_ai', status = 'past_due', ai_mode = 'managed', ai_monthly_credits = 0
where user_id = '00000000-0000-0000-0000-0000000028c2';
insert into public.ai_usage (user_id, month, credits_used, allowance_spent)
values ('00000000-0000-0000-0000-0000000028c2', (select m from t28_month), 50, 50);
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c2', (select m from t28_month)), true, 'past_due, allowance frozen at what was spent: exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c2', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;

-- The same with a revoked pack: the check is lenient (any pack row), the reservation refuses.
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at)
values ('00000000-0000-0000-0000-0000000028c2', (select m from t28_month), 500, 'cs_test_t28_revoked', now());
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c2', (select m from t28_month)), false, 'a revoked pack row makes the check defer (lenient)');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c2', (select m from t28_month), 1)), false, 'while the reservation still refuses (the reservation decides)');
reset role;

-- allowance_spent above a smaller allowance after recovery, all of it used.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 30
where user_id = '00000000-0000-0000-0000-0000000028c3';
insert into public.ai_usage (user_id, month, credits_used, allowance_spent)
values ('00000000-0000-0000-0000-0000000028c3', (select m from t28_month), 80, 80);
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c3', (select m from t28_month)), true, 'allowance_spent above the allowance, all used: exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c3', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;
-- 027's clamp: lowering credits_used below allowance_spent pulls it down; still consistent.
update public.ai_usage set credits_used = 20
where user_id = '00000000-0000-0000-0000-0000000028c3' and month = (select m from t28_month);
select is(
  (select allowance_spent from public.ai_usage where user_id = '00000000-0000-0000-0000-0000000028c3' and month = (select m from t28_month)),
  20,
  'allowance_spent follows credits_used down (027 clamp)'
);
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c3', (select m from t28_month)), false, '20 of 30 used: not exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c3', (select m from t28_month), 1)), true, 'and the reservation is allowed');
reset role;

-- Allowance used up but an unrevoked pack: the check defers, the reservation allows.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'managed', ai_monthly_credits = 100
where user_id = '00000000-0000-0000-0000-0000000028c4';
insert into public.ai_usage (user_id, month, credits_used)
values ('00000000-0000-0000-0000-0000000028c4', (select m from t28_month), 100);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
values ('00000000-0000-0000-0000-0000000028c4', (select m from t28_month), 50, 'cs_test_t28_pack');
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c4', (select m from t28_month)), false, 'allowance used, pack bought: not exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c4', (select m from t28_month), 1)), true, 'and the reservation is allowed');
reset role;

-- BYOK and free: no managed allowance, so a reservation is always refused.
update public.subscriptions set tier = 'pro_ai', status = 'active', ai_mode = 'byok', ai_monthly_credits = 100
where user_id = '00000000-0000-0000-0000-0000000028c5';
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c5', (select m from t28_month)), true, 'BYOK: exhausted (no managed allowance)');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c5', (select m from t28_month), 1)), false, 'and the reservation is refused');
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c6', (select m from t28_month)), true, 'free: exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c6', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;

-- Trialing / past_due with an allowance on the row: 027 counts the allowance only while
-- active, so each is exhausted and refused.
update public.subscriptions set tier = 'pro_ai', status = 'trialing', ai_mode = 'managed', ai_monthly_credits = 100
where user_id = '00000000-0000-0000-0000-0000000028c7';
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c7', (select m from t28_month)), true, 'trialing, allowance 100, 0 used: exhausted (no allowance until active)');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c7', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;
update public.subscriptions set status = 'past_due' where user_id = '00000000-0000-0000-0000-0000000028c7';
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c7', (select m from t28_month)), true, 'past_due, allowance 100, 0 used: exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c7', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;
insert into public.ai_usage (user_id, month, credits_used)
values ('00000000-0000-0000-0000-0000000028c7', (select m from t28_month), 100);
set local role service_role;
select is(public.ai_credits_exhausted('00000000-0000-0000-0000-0000000028c7', (select m from t28_month)), true, 'past_due, allowance 100, 100 used: exhausted');
select is((select allowed from public.ai_reserve_credits('00000000-0000-0000-0000-0000000028c7', (select m from t28_month), 1)), false, 'and the reservation is refused');
reset role;

-- The grid ------------------------------------------------------------------------------------
-- Every combination is set up, checked and reserved inside a subtransaction that is rolled back
-- (the raise at its end), so nothing carries over; only the two answers are kept.
create temporary table t28_grid (
  status text, tier text, mode text, allowance integer, used integer, spent integer, packs text,
  exhausted boolean, allowed boolean
) on commit drop;

do $$
declare
  v_user constant uuid := '00000000-0000-0000-0000-0000000028c8';
  v_month constant text := to_char(now() at time zone 'utc', 'YYYY-MM');
  st text; ti text; mo text; al integer; us integer; sp integer; pk text;
  v_exhausted boolean; v_allowed boolean;
begin
  foreach st in array array['active', 'trialing', 'past_due', 'canceled', 'incomplete'] loop
  foreach ti in array array['pro_ai', 'pro', 'free'] loop
  foreach mo in array array['managed', 'byok'] loop
  foreach al in array array[0, 50] loop
  foreach us in array array[0, 49, 50, 100] loop
  foreach sp in array array[-1, 0, 50] loop  -- -1: no allowance_spent (NULL)
  foreach pk in array array['none', 'revoked', 'live'] loop
    begin
      update public.subscriptions set tier = ti, status = st, ai_mode = mo, ai_monthly_credits = al
      where user_id = v_user;
      delete from public.ai_usage where user_id = v_user;
      delete from public.ai_credit_purchases where user_id = v_user;
      if us > 0 or sp >= 0 then
        insert into public.ai_usage (user_id, month, credits_used, allowance_spent)
        values (v_user, v_month, us, case when sp < 0 then null else least(sp, us) end);
      end if;
      if pk <> 'none' then
        insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at)
        values (v_user, v_month, 10, 'cs_test_t28_grid', case when pk = 'revoked' then now() end);
      end if;
      v_exhausted := public.ai_credits_exhausted(v_user, v_month);
      select r.allowed into v_allowed from public.ai_reserve_credits(v_user, v_month, 1) r;
      raise exception 'roll back this combination' using errcode = 'Z9028';
    exception when sqlstate 'Z9028' then
      null;
    end;
    insert into t28_grid values (st, ti, mo, al, us, sp, pk, v_exhausted, v_allowed);
  end loop; end loop; end loop; end loop; end loop; end loop; end loop;
end;
$$;

select is((select count(*)::integer from t28_grid), 2160, 'the grid ran every combination');
select is(
  (select count(*)::integer from t28_grid where exhausted and allowed),
  0,
  'no combination is "exhausted" while a 1-credit reservation would be allowed'
);
select ok((select count(*) from t28_grid where exhausted) > 0, 'the grid has exhausted combinations (the check is not trivially false)');
select ok((select count(*) from t28_grid where allowed) > 0, 'the grid has allowed combinations');

-- rate_limit_peek() ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select row(allowed, retry_after_seconds)::text from public.rate_limit_peek('t28_peek', 'k', array[3600], array[2])),
  '(t,0)',
  'an unused bucket has room'
);
select is((select count(*)::integer from public.rate_limit_counters where bucket = 't28_peek'), 0, 'a peek writes no row');
select is((select allowed from public.rate_limit_take('t28_peek', 'k', array[3600], array[2])), true, 'first take');
select is((select allowed from public.rate_limit_take('t28_peek', 'k', array[3600], array[2])), true, 'second take fills the window');
select is(
  (select row(allowed, retry_after_seconds > 0)::text from public.rate_limit_peek('t28_peek', 'k', array[3600], array[2])),
  '(f,t)',
  'a full window is refused with a wait'
);
select is(
  (select hits from public.rate_limit_counters where bucket = 't28_peek' and key = 'k' and window_seconds = 3600),
  2,
  'the peek counted nothing'
);
select throws_ok($$ select * from public.rate_limit_peek('b', 'k', array[[60], [3600]], array[[1], [1]]) $$, '22023', null, 'peek refuses two-dimensional arrays');
select throws_ok($$ select * from public.rate_limit_peek(null, 'k', array[60], array[1]) $$, '22023', null, 'peek refuses a NULL bucket');
select throws_ok($$ select * from public.rate_limit_peek('t28_peek', 'k', array[60, 3600, 60], array[1, 1, 1]) $$, '22023', null, 'peek refuses a window length listed twice, like rate_limit_take');
-- A stored window newer than the caller's clock (clock stepped back): take refuses, peek is the
-- lenient side and reports room. Only window_start moves; a refused take counts nothing.
reset role;
update public.rate_limit_counters set window_start = window_start + interval '2 hours'
where bucket = 't28_peek' and key = 'k' and window_seconds = 3600;
set local role service_role;
select is((select allowed from public.rate_limit_peek('t28_peek', 'k', array[3600], array[2])), true, 'peek treats a window newer than the clock as room (more lenient than take)');
select is((select allowed from public.rate_limit_take('t28_peek', 'k', array[3600], array[2])), false, 'while take refuses it (take decides)');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000028a1';
select throws_ok($$ select * from public.rate_limit_peek('ai-user', 'x', array[60], array[1]) $$, '42501', null, 'a signed-in user cannot peek');
reset role;
set local role anon;
select throws_ok($$ select * from public.rate_limit_peek('ai-user', 'x', array[60], array[1]) $$, '42501', null, 'anon cannot peek');
reset role;

select * from finish();
rollback;
