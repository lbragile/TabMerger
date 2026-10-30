-- 026_rate_limit_fixes.sql
--
-- Fixes to 025_rate_limits.sql found in its review, before the AI routes (much higher volume,
-- some fail-closed buckets) start calling rate_limit_take().
--
-- What this does:
--   1. rate_limit_take() reads the clock after it holds the per-key advisory lock, not before.
--      A caller that waited across a window boundary used to compute the window that had just
--      ended and reset the newer row back to it with hits = 1. Resetting is now one-way too: the
--      upsert only touches a row whose window is not newer than the caller's
--      (`where excluded.window_start >= c.window_start`). A caller whose clock is behind a stored
--      window (possible only if the server clock steps back) is refused, nothing is counted, and
--      retry_after_seconds runs until that stored window starts (at least 1). A write the guard
--      refuses anyway raises 40001 instead of returning allowed, so an uncounted hit is never
--      reported as allowed.
--   2. rate_limit_take() no longer deletes stale rows. The 1-in-100 inline DELETE could deadlock
--      with concurrent callers (it waited on rows another caller had just upserted, while that
--      caller could wait on rows the DELETE had locked). Cleanup is now
--      public.rate_limit_purge(p_limit): deletes up to p_limit rows whose window ended more than
--      two days ago, oldest first, skipping rows another transaction holds
--      (`for update skip locked`), and returns how many it deleted. It never waits on a lock, so
--      it can't deadlock with rate_limit_take(). Service role (and the owner) only.
--   3. pg_cron runs the purge every 10 minutes (job 'rate-limit-purge', batches of 5000, up to
--      720 000 rows a day). pg_cron is preloaded on Supabase (hosted and local); this enables the
--      extension if it isn't yet. The job runs as the role that applied this migration (postgres),
--      the function's owner.
--   4. rate_limit_take() runs with `lock_timeout = 1s`: a flood on one key can no longer hold
--      pool connections for the authenticator's 8 s. A timeout raises 55P03, which
--      lib/rateLimit.ts answers per the bucket's onError, like any other error.
--   5. rate_limit_take() refuses duplicate window lengths (22023): each would upsert the same row
--      twice and count the hit twice. It also refuses multi-dimensional arrays and arrays that
--      don't start at index 1.
--   6. rate_limit_counters is rewritten in place on every hit: fillfactor 70 leaves room for
--      HOT updates, and autovacuum runs after 5 % of the rows are dead instead of 20 %.
--   7. Checks the end state and fails the migration if it is not the one described above.
--
-- The function signature, return shape and grants of rate_limit_take() are unchanged.
--
-- Future IP-keyed callers: key an IPv6 client by its /64 prefix and an IPv4 client by its full
-- address. One IPv6 host usually holds a whole /64, so a key per address lets it rotate addresses
-- to escape the limit, and every rotated address adds rows to this table.
--
-- Re-running: every statement is idempotent (`create or replace`, `if not exists`, grants,
-- `alter table set`, and cron.schedule() with a job name updates the existing job).
--
-- Rollback, in this order:
--   select cron.unschedule('rate-limit-purge');
--   drop function if exists public.rate_limit_purge(integer);
--   -- then re-run section 2 of 025_rate_limits.sql (its `create or replace function
--   -- public.rate_limit_take`, comment, revoke and grant): `create or replace` also drops the
--   -- lock_timeout setting added here.
--   alter table public.rate_limit_counters reset (fillfactor, autovacuum_vacuum_scale_factor);
--   -- pg_cron can stay enabled; `drop extension pg_cron` only if nothing else uses it.
-- Rolling back 025 as well (dropping rate_limit_take): a bucket with onError 'deny' refuses
-- every request while the function is missing, so first deploy the web change that removes
-- its callers, then drop the function.

-- 1. Table storage -----------------------------------------------------------------------------
alter table public.rate_limit_counters set (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.05);

-- 2. Take a hit --------------------------------------------------------------------------------
create or replace function public.rate_limit_take(
  p_bucket text,
  p_key text,
  p_windows integer[],
  p_maxes integer[]
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_now timestamptz;
  v_count integer;
  v_window integer;
  v_max integer;
  v_start timestamptz;
  v_row_start timestamptz;
  v_hits integer;
  v_written integer;
  v_wait integer := 0;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'rate_limit_take: p_bucket must be 1-64 of [a-z0-9_:-], got %', p_bucket
      using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'rate_limit_take: p_key must be 1-200 characters' using errcode = '22023';
  end if;
  v_count := coalesce(pg_catalog.cardinality(p_windows), 0);
  if v_count not between 1 and 5
     or coalesce(pg_catalog.cardinality(p_maxes), 0) <> v_count
     or pg_catalog.array_ndims(p_windows) <> 1 or pg_catalog.array_lower(p_windows, 1) <> 1
     or pg_catalog.array_ndims(p_maxes) <> 1 or pg_catalog.array_lower(p_maxes, 1) <> 1 then
    raise exception 'rate_limit_take: p_windows and p_maxes must be one-dimensional with the same 1-5 elements'
      using errcode = '22023';
  end if;
  for i in 1..v_count loop
    if p_windows[i] is null or p_windows[i] not between 1 and 86400 then
      raise exception 'rate_limit_take: window % must be 1-86400 seconds, got %', i, p_windows[i]
        using errcode = '22023';
    end if;
    if p_windows[i] = any (p_windows[1:i - 1]) then
      raise exception 'rate_limit_take: window % (% seconds) is listed twice', i, p_windows[i]
        using errcode = '22023';
    end if;
    if p_maxes[i] is null or p_maxes[i] < 1 then
      raise exception 'rate_limit_take: max % must be at least 1, got %', i, p_maxes[i]
        using errcode = '22023';
    end if;
  end loop;

  -- One caller at a time per (bucket, key), until this transaction ends. Waits at most
  -- lock_timeout (1 s), then raises 55P03.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bucket || pg_catalog.chr(1) || p_key, 25)
  );

  -- The time is read only now: a caller that waited for the lock must not count in a window
  -- that ended while it waited.
  v_now := pg_catalog.clock_timestamp();

  -- Room in every window? A full one refuses the call and says when it ends.
  for i in 1..v_count loop
    v_window := p_windows[i];
    v_max := p_maxes[i];
    v_start := pg_catalog.to_timestamp(
      pg_catalog.floor(extract(epoch from v_now) / v_window) * v_window
    );
    v_row_start := null;
    v_hits := null;
    select c.window_start, c.hits into v_row_start, v_hits
    from public.rate_limit_counters c
    where c.bucket = p_bucket and c.key = p_key and c.window_seconds = v_window;

    if v_row_start > v_start then
      -- The stored window is newer than this caller's clock (the server clock stepped back).
      -- Counting here would either reset that window or count in one this caller can't see, so
      -- refuse until the clock reaches the stored window.
      v_wait := greatest(
        v_wait,
        1,
        pg_catalog.ceil(extract(epoch from (v_row_start - v_now)))::integer
      );
    elsif v_row_start = v_start and v_hits >= v_max then
      v_wait := greatest(
        v_wait,
        1,
        pg_catalog.ceil(extract(epoch from (v_start + pg_catalog.make_interval(secs => v_window) - v_now)))::integer
      );
    end if;
  end loop;

  if v_wait > 0 then
    allowed := false;
    retry_after_seconds := v_wait;
    return next;
    return;
  end if;

  for i in 1..v_count loop
    v_window := p_windows[i];
    v_start := pg_catalog.to_timestamp(
      pg_catalog.floor(extract(epoch from v_now) / v_window) * v_window
    );
    insert into public.rate_limit_counters as c (bucket, key, window_seconds, window_start, hits)
    values (p_bucket, p_key, v_window, v_start, 1)
    on conflict (bucket, key, window_seconds) do update
      set hits = case when c.window_start = excluded.window_start then c.hits + 1 else 1 end,
          window_start = excluded.window_start
      where excluded.window_start >= c.window_start;
    get diagnostics v_written = row_count;
    if v_written <> 1 then
      -- Unreachable while the check above holds (same lock, same clock reading). If it ever is
      -- reached, abort: the hits already counted in this call roll back with the caller's
      -- transaction, and an uncounted hit is never reported as allowed.
      raise exception 'rate_limit_take: window % of (%, ...) moved past this call; retry', v_window, p_bucket
        using errcode = '40001';
    end if;
  end loop;

  allowed := true;
  retry_after_seconds := 0;
  return next;
end;
$$;

comment on function public.rate_limit_take(text, text, integer[], integer[]) is
  'Counts one hit for (bucket, key) against fixed windows when all have room; returns (allowed, retry_after_seconds). Service role only (025, fixed in 026).';

revoke execute on function public.rate_limit_take(text, text, integer[], integer[]) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, text, integer[], integer[]) to service_role;

-- 3. Purge stale rows --------------------------------------------------------------------------
create or replace function public.rate_limit_purge(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := pg_catalog.clock_timestamp() - interval '2 days';
  v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 100000 then
    raise exception 'rate_limit_purge: p_limit must be 1-100000, got %', p_limit
      using errcode = '22023';
  end if;

  -- A window ends after it starts, so `window_start < v_cutoff` (indexed) is implied by the
  -- exact test and narrows the scan. Rows another transaction holds (a rate_limit_take() that
  -- is counting on them right now) are skipped, so this never waits on a lock.
  delete from public.rate_limit_counters c
  where c.ctid = any (array(
    select s.ctid
    from public.rate_limit_counters s
    where s.window_start < v_cutoff
      and s.window_start + pg_catalog.make_interval(secs => s.window_seconds) < v_cutoff
    order by s.window_start
    limit p_limit
    for update skip locked
  ));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.rate_limit_purge(integer) is
  'Deletes up to p_limit rate_limit_counters rows whose window ended more than 2 days ago, skipping locked rows; returns the count. Run by pg_cron job rate-limit-purge. Service role only (026).';

revoke execute on function public.rate_limit_purge(integer) from public, anon, authenticated;
grant execute on function public.rate_limit_purge(integer) to service_role;

-- 4. Schedule the purge --------------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'rate-limit-purge',
  '*/10 * * * *',
  $cron$select public.rate_limit_purge(5000)$cron$
);

-- 5. End-state check ---------------------------------------------------------------------------
do $$
declare
  api_role text;
  priv text;
  fn regprocedure;
begin
  -- Primary key and index, exactly.
  if (
    select pg_catalog.pg_get_indexdef(i.indexrelid)
    from pg_catalog.pg_index i
    where i.indrelid = 'public.rate_limit_counters'::regclass and i.indisprimary
  ) is distinct from
    'CREATE UNIQUE INDEX rate_limit_counters_pkey ON public.rate_limit_counters USING btree (bucket, key, window_seconds)'
  then
    raise exception 'rate_limit_counters: primary key is not exactly (bucket, key, window_seconds)';
  end if;

  if (
    select pg_catalog.pg_get_indexdef(i.indexrelid)
    from pg_catalog.pg_index i
    where i.indexrelid = 'public.rate_limit_counters_window_start_idx'::regclass
  ) is distinct from
    'CREATE INDEX rate_limit_counters_window_start_idx ON public.rate_limit_counters USING btree (window_start)'
  then
    raise exception 'rate_limit_counters_window_start_idx: must be a plain btree on (window_start)';
  end if;

  -- Storage options.
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.rate_limit_counters'::regclass
      and reloptions @> array['fillfactor=70', 'autovacuum_vacuum_scale_factor=0.05']
  ) then
    raise exception 'rate_limit_counters: fillfactor / autovacuum_vacuum_scale_factor not set';
  end if;

  -- RLS on, no policy, nothing granted to the API roles or PUBLIC.
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.rate_limit_counters'::regclass and relrowsecurity
  ) then
    raise exception 'rate_limit_counters: row level security is not enabled';
  end if;

  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'rate_limit_counters') then
    raise exception 'rate_limit_counters: has a policy; it must have none';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c,
         pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where c.oid = 'public.rate_limit_counters'::regclass and a.grantee = 0
  ) then
    raise exception 'rate_limit_counters: PUBLIC holds a privilege on it';
  end if;

  foreach fn in array array[
    'public.rate_limit_take(text, text, integer[], integer[])'::regprocedure,
    'public.rate_limit_purge(integer)'::regprocedure
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_proc p,
           pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      where p.oid = fn and a.grantee = 0
    ) then
      raise exception '%: PUBLIC can execute it', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '%: service_role cannot execute it', fn;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_proc
      where oid = fn and prosecdef and proconfig @> array['search_path=""']
    ) then
      raise exception '%: must be security definer with an empty search_path', fn;
    end if;
  end loop;

  foreach api_role in array array['anon', 'authenticated'] loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(api_role, 'public.rate_limit_counters', priv) then
        raise exception 'rate_limit_counters: role % still holds %', api_role, priv;
      end if;
    end loop;
    if has_any_column_privilege(api_role, 'public.rate_limit_counters', 'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception 'rate_limit_counters: role % holds a column privilege', api_role;
    end if;
    if has_function_privilege(api_role, 'public.rate_limit_take(text, text, integer[], integer[])', 'EXECUTE') then
      raise exception 'rate_limit_take: role % can execute it', api_role;
    end if;
    if has_function_privilege(api_role, 'public.rate_limit_purge(integer)', 'EXECUTE') then
      raise exception 'rate_limit_purge: role % can execute it', api_role;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = 'public.rate_limit_take(text, text, integer[], integer[])'::regprocedure
      and proconfig @> array['lock_timeout=1s']
  ) then
    raise exception 'rate_limit_take: lock_timeout must be 1s';
  end if;

  -- The purge is scheduled.
  if not exists (
    select 1 from cron.job
    where jobname = 'rate-limit-purge'
      and schedule = '*/10 * * * *'
      and command = 'select public.rate_limit_purge(5000)'
      and active
  ) then
    raise exception 'pg_cron job rate-limit-purge is missing or differs';
  end if;
end;
$$;
