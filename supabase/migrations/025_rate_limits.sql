-- 025_rate_limits.sql
--
-- A per-key request rate limit shared by every server instance. The web app runs on many
-- Vercel instances at once, so a counter kept in one instance's memory limits nothing; the
-- counters live here instead. First used by the cookie-auth billing routes (checkout, plan
-- switch, keep current plan, cancel, billing portal), keyed by user id; built so other routes
-- (the AI routes, keyed by user id or client IP) can use it with their own bucket and limits.
--
-- What this does:
--   1. public.rate_limit_counters: one row per (bucket, key, window length) holding the start of
--      the current fixed window and the hits counted in it. Windows are aligned to the Unix
--      epoch (a 60 s window runs from :00 to :59), so every instance agrees on them. A row is
--      reset in place when a new window starts, so a key that keeps calling never grows the
--      table. RLS is on with no policy and the API roles have no privileges on it: only
--      rate_limit_take() (security definer) reads and writes it.
--   2. public.rate_limit_take(p_bucket, p_key, p_windows, p_maxes): counts one hit for the key
--      against every limit (p_windows[i] seconds, at most p_maxes[i] hits) when all of them
--      still have room, and returns (allowed, retry_after_seconds). When any limit is full,
--      nothing is counted (a refused request doesn't use up a longer window) and
--      retry_after_seconds is the time until the last full window ends, at least 1. Calls for
--      one (bucket, key) are serialized by a transaction-scoped advisory lock, so concurrent
--      requests can't both take the last slot. EXECUTE is service_role only: a signed-in user
--      calling it through PostgREST could otherwise use up another user's allowance.
--   3. About 1 call in 100 also deletes rows whose window started more than two days ago
--      (windows are at most one day long, so those are stale: keys that stopped calling).
--      Indexed on window_start.
--   4. Checks the end state and fails the migration if it is not the one described above.
--
-- Re-running: the table and index use `if not exists`, the function `create or replace`, and
-- the grants are idempotent.
--
-- Rollback (nothing else references these; the web app's limiter fails open when the
-- function is missing, see lib/rateLimit.ts):
--   drop function if exists public.rate_limit_take(text, text, integer[], integer[]);
--   drop table if exists public.rate_limit_counters;

-- 1. Counters ---------------------------------------------------------------------------------
create table if not exists public.rate_limit_counters (
  bucket text not null,
  key text not null,
  window_seconds integer not null,
  window_start timestamptz not null,
  hits integer not null,
  constraint rate_limit_counters_pkey primary key (bucket, key, window_seconds),
  constraint rate_limit_counters_window_seconds_check check (window_seconds between 1 and 86400),
  constraint rate_limit_counters_hits_check check (hits >= 0)
);

comment on table public.rate_limit_counters is
  'Fixed-window request counters per (bucket, key, window). Written only by rate_limit_take() (025).';

create index if not exists rate_limit_counters_window_start_idx
  on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;

revoke all on table public.rate_limit_counters from public, anon, authenticated;

-- 2. Take a hit -------------------------------------------------------------------------------
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
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
  v_window integer;
  v_max integer;
  v_start timestamptz;
  v_hits integer;
  v_wait integer := 0;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'rate_limit_take: p_bucket must be 1-64 of [a-z0-9_:-], got %', p_bucket
      using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'rate_limit_take: p_key must be 1-200 characters' using errcode = '22023';
  end if;
  v_count := coalesce(array_length(p_windows, 1), 0);
  if v_count not between 1 and 5 or coalesce(array_length(p_maxes, 1), 0) <> v_count then
    raise exception 'rate_limit_take: p_windows and p_maxes must have the same 1-5 elements'
      using errcode = '22023';
  end if;
  for i in 1..v_count loop
    if p_windows[i] is null or p_windows[i] not between 1 and 86400 then
      raise exception 'rate_limit_take: window % must be 1-86400 seconds, got %', i, p_windows[i]
        using errcode = '22023';
    end if;
    if p_maxes[i] is null or p_maxes[i] < 1 then
      raise exception 'rate_limit_take: max % must be at least 1, got %', i, p_maxes[i]
        using errcode = '22023';
    end if;
  end loop;

  -- One caller at a time per (bucket, key), until this transaction ends.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_bucket || pg_catalog.chr(1) || p_key, 25)
  );

  -- Room in every window? A full one refuses the call and says when it ends.
  for i in 1..v_count loop
    v_window := p_windows[i];
    v_max := p_maxes[i];
    v_start := pg_catalog.to_timestamp(
      pg_catalog.floor(extract(epoch from v_now) / v_window) * v_window
    );
    select c.hits into v_hits
    from public.rate_limit_counters c
    where c.bucket = p_bucket and c.key = p_key and c.window_seconds = v_window
      and c.window_start = v_start;
    if coalesce(v_hits, 0) >= v_max then
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
          window_start = excluded.window_start;
  end loop;

  -- Housekeeping, now and then: rows of keys that stopped calling.
  if pg_catalog.random() < 0.01 then
    delete from public.rate_limit_counters c
    where c.window_start < v_now - interval '2 days';
  end if;

  allowed := true;
  retry_after_seconds := 0;
  return next;
end;
$$;

comment on function public.rate_limit_take(text, text, integer[], integer[]) is
  'Counts one hit for (bucket, key) against fixed windows when all have room; returns (allowed, retry_after_seconds). Service role only (025).';

revoke execute on function public.rate_limit_take(text, text, integer[], integer[]) from public, anon, authenticated;
grant execute on function public.rate_limit_take(text, text, integer[], integer[]) to service_role;

-- 4. End-state check --------------------------------------------------------------------------
do $$
declare
  api_role text;
  priv text;
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.rate_limit_counters'::regclass and relrowsecurity
  ) then
    raise exception 'rate_limit_counters: row level security is not enabled';
  end if;

  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'rate_limit_counters') then
    raise exception 'rate_limit_counters: has a policy; it must have none';
  end if;

  foreach api_role in array array['anon', 'authenticated'] loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(api_role, 'public.rate_limit_counters', priv) then
        raise exception 'rate_limit_counters: role % still holds %', api_role, priv;
      end if;
    end loop;
    if has_function_privilege(api_role, 'public.rate_limit_take(text, text, integer[], integer[])', 'EXECUTE') then
      raise exception 'rate_limit_take: role % can execute it', api_role;
    end if;
  end loop;

  if not has_function_privilege('service_role', 'public.rate_limit_take(text, text, integer[], integer[])', 'EXECUTE') then
    raise exception 'rate_limit_take: service_role cannot execute it';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = 'public.rate_limit_take(text, text, integer[], integer[])'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'rate_limit_take: must be security definer with an empty search_path';
  end if;
end;
$$;
