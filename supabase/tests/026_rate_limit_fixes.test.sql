-- pgTAP test for 026_rate_limit_fixes.sql (025's tests still cover counting, isolation and the
-- privileges of rate_limit_take; this file covers what 026 changes or adds).
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves:
--   - The primary key and the window_start index are exactly what the limiter relies on
--     (pg_get_indexdef), and the table has its fillfactor / autovacuum settings.
--   - rate_limit_take() runs with lock_timeout = 1s.
--   - rate_limit_purge() is security definer with an empty search_path, only the service role
--     can call it (anon and a signed-in user get 42501, PUBLIC holds nothing), and pg_cron runs
--     it every 10 minutes.
--   - A call whose clock is behind a stored window (a newer window planted in the table) is
--     refused, leaves that row unchanged and counts nothing in its other windows.
--   - Duplicate window lengths, multi-dimensional arrays, a 65-character bucket, a 201-character
--     key and NULL bucket / key are refused (22023); 64 and 200 characters are accepted.
--   - rate_limit_purge() deletes only rows whose window ended more than two days ago, oldest
--     first, at most p_limit per call, and refuses a bad limit.
--
-- Not covered here: `for update skip locked` in the purge and the lock_timeout firing both need
-- a second session holding a lock, which one pgTAP transaction can't provide (a transaction
-- never blocks on its own locks). Check those by hand with two psql sessions.
--
-- Everything runs in one transaction that is rolled back.

begin;
select plan(35);

-- Shape -------------------------------------------------------------------------------------
select is(
  (select pg_catalog.pg_get_indexdef(i.indexrelid) from pg_catalog.pg_index i
    where i.indrelid = 'public.rate_limit_counters'::regclass and i.indisprimary),
  'CREATE UNIQUE INDEX rate_limit_counters_pkey ON public.rate_limit_counters USING btree (bucket, key, window_seconds)',
  'primary key is exactly (bucket, key, window_seconds)'
);
select is(
  pg_catalog.pg_get_indexdef('public.rate_limit_counters_window_start_idx'::regclass),
  'CREATE INDEX rate_limit_counters_window_start_idx ON public.rate_limit_counters USING btree (window_start)',
  'window_start_idx is a btree on window_start'
);
select ok(
  (select reloptions @> array['fillfactor=70', 'autovacuum_vacuum_scale_factor=0.05']
     from pg_catalog.pg_class where oid = 'public.rate_limit_counters'::regclass),
  'rate_limit_counters has fillfactor 70 and autovacuum scale factor 0.05'
);
select ok(
  (select proconfig @> array['search_path=""', 'lock_timeout=1s'] from pg_catalog.pg_proc
    where oid = 'public.rate_limit_take(text, text, integer[], integer[])'::regprocedure),
  'rate_limit_take runs with an empty search_path and lock_timeout = 1s'
);

-- Purge privileges and schedule ---------------------------------------------------------------
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_catalog.pg_proc
    where oid = 'public.rate_limit_purge(integer)'::regprocedure),
  'rate_limit_purge is security definer with an empty search_path'
);
select ok(not has_function_privilege('anon', 'public.rate_limit_purge(integer)', 'EXECUTE'), 'anon cannot execute rate_limit_purge');
select ok(not has_function_privilege('authenticated', 'public.rate_limit_purge(integer)', 'EXECUTE'), 'authenticated cannot execute rate_limit_purge');
select ok(has_function_privilege('service_role', 'public.rate_limit_purge(integer)', 'EXECUTE'), 'service_role can execute rate_limit_purge');
select is(
  (select count(*)::integer from pg_catalog.pg_proc p,
          pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = 'public.rate_limit_purge(integer)'::regprocedure and a.grantee = 0),
  0,
  'PUBLIC holds no privilege on rate_limit_purge'
);
select is(
  (select row(schedule, command, active)::text from cron.job where jobname = 'rate-limit-purge'),
  '("*/10 * * * *","select public.rate_limit_purge(5000)",t)',
  'pg_cron runs the purge every 10 minutes in batches of 5000'
);
select ok(
  not has_schema_privilege('anon', 'cron', 'USAGE') and not has_schema_privilege('authenticated', 'cron', 'USAGE'),
  'the API roles cannot use the cron schema'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select throws_ok($$ select public.rate_limit_purge() $$, '42501', null, 'a signed-in user cannot call rate_limit_purge');
reset role;
set local role anon;
select throws_ok($$ select public.rate_limit_purge() $$, '42501', null, 'anon cannot call rate_limit_purge');
reset role;

-- Stale clock: a stored window newer than the caller's ---------------------------------------
-- Planted two hours ahead, so it stays ahead even if the hour turns during the test.
insert into public.rate_limit_counters (bucket, key, window_seconds, window_start, hits)
values (
  't26_stale', 'user-a', 3600,
  pg_catalog.to_timestamp(pg_catalog.floor(extract(epoch from clock_timestamp()) / 3600) * 3600 + 7200),
  1
);
create temporary table t26_planted on commit drop as
  select window_start, hits from public.rate_limit_counters where bucket = 't26_stale';
grant select on t26_planted to service_role;

set local role service_role;
select is(
  (select row(allowed, retry_after_seconds > 3600)::text
     from public.rate_limit_take('t26_stale', 'user-a', array[3600], array[10])),
  '(f,t)',
  'a call whose clock is behind the stored window is refused until that window starts'
);
select is(
  (select row(c.window_start = p.window_start, c.hits = p.hits)::text
     from public.rate_limit_counters c, t26_planted p
    where c.bucket = 't26_stale' and c.key = 'user-a' and c.window_seconds = 3600),
  '(t,t)',
  'the newer window was left unchanged (not moved back, not counted)'
);
select is(
  (select allowed from public.rate_limit_take('t26_stale', 'user-a', array[60, 3600], array[10, 10])),
  false,
  'refused too when another window of the call has room'
);
select is(
  (select count(*)::integer from public.rate_limit_counters
    where bucket = 't26_stale' and key = 'user-a' and window_seconds = 60),
  0,
  'the refused call counted nothing in the window that had room'
);

-- Bad input -----------------------------------------------------------------------------------
select throws_ok($$ select * from public.rate_limit_take('b', 'k', array[60, 60], array[1, 2]) $$, '22023', null, 'duplicate window lengths refused');
select throws_ok($$ select * from public.rate_limit_take('b', 'k', array[60, 3600, 60], array[1, 2, 3]) $$, '22023', null, 'a non-adjacent duplicate window refused');
select throws_ok($$ select * from public.rate_limit_take('b', 'k', array[[60], [3600]], array[[1], [1]]) $$, '22023', null, 'two-dimensional arrays refused');
select throws_ok($$ select * from public.rate_limit_take(repeat('a', 65), 'k', array[60], array[1]) $$, '22023', null, '65-character bucket refused');
select is((select allowed from public.rate_limit_take(repeat('a', 64), 'k', array[3600], array[1])), true, '64-character bucket accepted');
select throws_ok($$ select * from public.rate_limit_take('b', repeat('k', 201), array[60], array[1]) $$, '22023', null, '201-character key refused');
select is((select allowed from public.rate_limit_take('t26_len', repeat('k', 200), array[3600], array[1])), true, '200-character key accepted');
select throws_ok($$ select * from public.rate_limit_take(null, 'k', array[60], array[1]) $$, '22023', null, 'NULL bucket refused');
select throws_ok($$ select * from public.rate_limit_take('b', null, array[60], array[1]) $$, '22023', null, 'NULL key refused');
select throws_ok($$ select * from public.rate_limit_take('b', 'k', null, null) $$, '22023', null, 'NULL windows refused');
reset role;

-- Purge -------------------------------------------------------------------------------------
-- Start from an empty table (rolled back with the rest), then plant rows around the cutoff.
delete from public.rate_limit_counters;
insert into public.rate_limit_counters (bucket, key, window_seconds, window_start, hits) values
  -- Ended more than two days ago: deleted.
  ('t26_purge', 'old-1', 60, now() - interval '3 days' - interval '1 minute', 1),
  ('t26_purge', 'old-2', 60, now() - interval '3 days' - interval '2 minutes', 1),
  ('t26_purge', 'old-3', 60, now() - interval '3 days' - interval '3 minutes', 1),
  ('t26_purge', 'old-4', 60, now() - interval '3 days' - interval '4 minutes', 1),
  ('t26_purge', 'old-day', 86400, now() - interval '3 days' - interval '1 hour', 1),
  -- Started more than two days ago but ended less than two days ago: kept.
  ('t26_purge', 'day-ended-recently', 86400, now() - interval '2 days' - interval '1 hour', 1),
  -- Current: kept.
  ('t26_purge', 'recent', 60, now() - interval '1 hour', 1);

set local role service_role;
select is(public.rate_limit_purge(2), 2, 'purge deletes at most p_limit rows');
select is(
  (select count(*)::integer from public.rate_limit_counters where key in ('old-day', 'old-4')),
  0,
  'the oldest rows go first'
);
select is(public.rate_limit_purge(), 3, 'purge with the default limit deletes the remaining stale rows');
select is(
  (select array_agg(key order by key) from public.rate_limit_counters),
  array['day-ended-recently', 'recent'],
  'rows whose window ended less than two days ago are kept'
);
select is(public.rate_limit_purge(), 0, 'nothing left to purge');
select throws_ok($$ select public.rate_limit_purge(0) $$, '22023', null, 'purge limit 0 refused');
select throws_ok($$ select public.rate_limit_purge(null) $$, '22023', null, 'purge limit NULL refused');
select throws_ok($$ select public.rate_limit_purge(100001) $$, '22023', null, 'purge limit over 100000 refused');
reset role;

select * from finish();
rollback;
