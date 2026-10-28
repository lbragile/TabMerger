-- pgTAP test for 025_rate_limits.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves:
--   - rate_limit_counters has RLS on, no policy, and no privileges for anon / authenticated, so
--     a client can neither read nor write it.
--   - rate_limit_take() runs as its owner with an empty search_path, and only the service role
--     can call it (anon and a signed-in user get 42501).
--   - Each limit allows exactly `max` hits per window; the next is refused with a wait that ends
--     with the window; a refused call counts nothing (not even in a longer window that had room).
--   - The longest full window decides the wait when several are full.
--   - Keys and buckets are counted apart.
--   - A new window starts the count again (simulated by moving the stored window back in time).
--   - Bad input is refused.
--
-- Long windows (one hour, one day) are used where the count must not roll over during the test:
-- rate_limit_take() reads clock_timestamp(), which keeps moving inside the transaction.
--
-- Everything runs in one transaction that is rolled back.

begin;
select plan(29);

-- Shape and privileges -------------------------------------------------------------------------
select has_table('public', 'rate_limit_counters', 'rate_limit_counters exists');
select col_is_pk('public', 'rate_limit_counters', array['bucket', 'key', 'window_seconds'], 'primary key is (bucket, key, window_seconds)');
select has_index('public', 'rate_limit_counters', 'rate_limit_counters_window_start_idx', 'window_start is indexed for the cleanup');
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.rate_limit_counters'::regclass),
  'RLS is enabled'
);
select is(
  (select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'rate_limit_counters'),
  0,
  'no policy on rate_limit_counters'
);
select ok(not has_table_privilege('authenticated', 'public.rate_limit_counters', 'SELECT'), 'authenticated cannot select');
select ok(not has_table_privilege('anon', 'public.rate_limit_counters', 'INSERT'), 'anon cannot insert');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_catalog.pg_proc
    where oid = 'public.rate_limit_take(text, text, integer[], integer[])'::regprocedure),
  'rate_limit_take is security definer with an empty search_path'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select throws_ok(
  $$ select * from public.rate_limit_take('billing', '00000000-0000-0000-0000-0000000000f2', array[60], array[10]) $$,
  '42501',
  null,
  'a signed-in user cannot call rate_limit_take (could use up someone else''s allowance)'
);
select throws_ok(
  $$ select * from public.rate_limit_counters $$,
  '42501',
  null,
  'a signed-in user cannot read the counters'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.rate_limit_take('billing', 'k', array[60], array[10]) $$,
  '42501',
  null,
  'anon cannot call rate_limit_take'
);
reset role;

-- Counting ----------------------------------------------------------------------------------
set local role service_role;

select is((select allowed from public.rate_limit_take('t_count', 'user-a', array[3600], array[2])), true, '1st hit allowed');
select is((select allowed from public.rate_limit_take('t_count', 'user-a', array[3600], array[2])), true, '2nd hit allowed (max 2)');
select is(
  (select row(allowed, retry_after_seconds between 1 and 3600)::text
     from public.rate_limit_take('t_count', 'user-a', array[3600], array[2])),
  '(f,t)',
  '3rd hit refused, with a wait of at most the window'
);
select is(
  (select hits from public.rate_limit_counters where bucket = 't_count' and key = 'user-a'),
  2,
  'the refused hit was not counted'
);

-- Isolation
select is((select allowed from public.rate_limit_take('t_count', 'user-b', array[3600], array[2])), true, 'another key has its own count');
select is((select allowed from public.rate_limit_take('t_other', 'user-a', array[3600], array[2])), true, 'another bucket has its own count');

-- New window: move user-a's window an hour back, as if it had ended.
reset role;
update public.rate_limit_counters set window_start = window_start - interval '1 hour'
  where bucket = 't_count' and key = 'user-a';
set local role service_role;
select is((select allowed from public.rate_limit_take('t_count', 'user-a', array[3600], array[2])), true, 'allowed again once the window has ended');
select is(
  (select hits from public.rate_limit_counters where bucket = 't_count' and key = 'user-a'),
  1,
  'the new window starts counting from 1'
);

-- Several windows: the short one has room, the long one is full -> refused, nothing counted.
select is((select allowed from public.rate_limit_take('t_multi', 'user-a', array[3600, 86400], array[5, 1])), true, 'multi: 1st allowed');
select is(
  (select allowed from public.rate_limit_take('t_multi', 'user-a', array[3600, 86400], array[5, 1])),
  false,
  'multi: refused by the full day window although the hour has room'
);
select is(
  (select hits from public.rate_limit_counters where bucket = 't_multi' and key = 'user-a' and window_seconds = 3600),
  1,
  'multi: the refused hit did not count in the hour window either'
);

-- Wait = the later end among the full windows (hour and day both full).
select is(
  (select retry_after_seconds >= (
            extract(epoch from (pg_catalog.date_trunc('day', clock_timestamp() at time zone 'UTC') + interval '1 day'))
            - extract(epoch from clock_timestamp() at time zone 'UTC') - 2)::integer
     from public.rate_limit_take('t_multi', 'user-a', array[86400, 3600], array[1, 1])),
  true,
  'the wait runs to the end of the longest full window'
);

-- Bad input
select throws_ok($$ select * from public.rate_limit_take('', 'k', array[60], array[1]) $$, '22023', null, 'empty bucket refused');
select throws_ok($$ select * from public.rate_limit_take('Bad Bucket', 'k', array[60], array[1]) $$, '22023', null, 'bucket outside [a-z0-9_:-] refused');
select throws_ok($$ select * from public.rate_limit_take('b', '', array[60], array[1]) $$, '22023', null, 'empty key refused');
select throws_ok($$ select * from public.rate_limit_take('b', 'k', array[60, 3600], array[1]) $$, '22023', null, 'mismatched arrays refused');
select throws_ok($$ select * from public.rate_limit_take('b', 'k', array[86401], array[1]) $$, '22023', null, 'window over a day refused');
select throws_ok($$ select * from public.rate_limit_take('b', 'k', array[60], array[0]) $$, '22023', null, 'max below 1 refused');

reset role;

select * from finish();
rollback;
