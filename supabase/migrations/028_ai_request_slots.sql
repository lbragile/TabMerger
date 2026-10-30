-- 028_ai_request_slots.sql
--
-- Server-side guards for the /api/ai/* routes, all called by the web app with the service role
-- only:
--
--   * a per-user cap on AI requests running at the same time (the web app sets the cap,
--     AI_MAX_CONCURRENT_REQUESTS in lib/ai-request-limits.ts), shared by every Vercel instance,
--     so one account can't fire thousands of concurrent calls;
--   * a cheap read that says a managed user's credits are certainly used up, so the route can
--     refuse before it spends an Anthropic count_tokens call on a request the credit
--     reservation would refuse anyway;
--   * a read-only look at a rate-limit bucket (025) that counts nothing, for limits that are
--     checked before a call and counted only when the call fails (own-key failures).
--
-- What this does:
--   1. public.ai_request_slots: one row per AI request in flight (id, user, lease end). RLS is on
--      with no policy and the API roles hold nothing on it: only the functions below touch it.
--      A row is a lease: a request that crashed or was killed before it released its slot stops
--      counting once expires_at passes (the web app leases for its route's maxDuration plus a
--      margin), so a slot never leaks for longer than one lease. The foreign key to auth.users
--      (on delete cascade) takes SHARE ROW EXCLUSIVE on auth.users while the table is created,
--      so the file runs with lock_timeout 5s: if something slow holds auth.users, the migration
--      fails fast instead of stalling every sign-in and sign-up write behind it.
--   2. public.ai_slot_acquire(p_user, p_max, p_lease_seconds): under a per-user advisory lock
--      (one caller per user at a time), reads the clock after the lock, counts that user's live
--      leases (expires_at > now), and when fewer than p_max inserts a lease and returns its id;
--      otherwise returns NULL (inserts nothing). Expired leases of the user are deleted on the
--      way, skipping rows another transaction holds (the purge's pattern), so an acquire never
--      waits on the purge. lock_timeout 1s: a flood on one user can't hold pool connections; a
--      timeout raises 55P03, which the web app answers as unavailable. Refuses to run outside
--      READ COMMITTED (25001): the count after the lock only sees leases committed by earlier
--      holders of the lock under READ COMMITTED, which is what keeps two callers from both
--      taking the last slot.
--   3. public.ai_slot_release(p_user, p_slot): deletes that lease (only when it belongs to
--      p_user); returns whether a row was deleted. Called in the route's `finally`.
--   4. public.ai_slot_purge(p_limit): deletes up to p_limit leases that expired more than an
--      hour ago (users who never came back), oldest first, skipping rows another transaction
--      holds, so it never waits on a lock. pg_cron runs it every 10 minutes ('ai-slot-purge').
--   5. public.ai_credits_exhausted(p_user, p_month): read-only. True only when the user has NO
--      ai_credit_purchases row at all for p_month (revoked or not) AND ai_usage.credits_used for
--      p_month is at least A, the managed allowance as 027's ai_reserve_credits() counts it
--      (subscriptions.ai_monthly_credits for a pro_ai + managed + active subscription, else 0;
--      clamped like 027). Why it is never stricter than ai_reserve_credits(): with no pack rows
--      the reservation's cap is at most max(A, allowance_spent), and allowance_spent <=
--      credits_used is guaranteed by 027's CHECK constraint ai_usage_allowance_spent_check, so
--      used >= A means used >= cap, and a reservation (at least 1 credit) is refused. Any pack
--      row makes it answer false and leaves the decision to ai_reserve_credits(), which stays the
--      only authority. If 027's allowance rule ever counts more statuses again, this function
--      must follow it (the 028 pgTAP grid fails otherwise). It does not call or replace
--      ai_reserve_credits().
--   6. public.rate_limit_peek(p_bucket, p_key, p_windows, p_maxes): the check half of
--      rate_limit_take() (025, as 026 left it) without the count. Same arguments and the same
--      22023 input checks, duplicate window lengths included, and the same
--      (allowed, retry_after_seconds) answer for a full window. It differs in being more lenient,
--      never stricter: it takes no lock and writes nothing, so concurrent peeks can all pass
--      before any of them counts (bounded by ai_slot_acquire's per-user cap); and a stored window
--      newer than the caller's clock (the server clock stepped back), which rate_limit_take
--      refuses, counts as room here. It only saves a call; rate_limit_take still decides
--      whenever a call is counted.
--   7. Checks the end state and fails the migration if it is not the one described above.
--
-- Re-running: the table and indexes use `if not exists`, the functions `create or replace`,
-- grants are idempotent, cron.schedule() with a job name updates the existing job, and the job
-- is set active again.
--
-- Rollback, in this order (deploy the web change that stops calling these first: the web app
-- refuses AI requests with 503 while the slot functions are missing):
--   set lock_timeout = '5s';
--   select cron.unschedule(jobid) from cron.job where jobname = 'ai-slot-purge';
--   drop function if exists public.rate_limit_peek(text, text, integer[], integer[]);
--   drop function if exists public.ai_credits_exhausted(uuid, text);
--   drop function if exists public.ai_slot_purge(integer);
--   drop function if exists public.ai_slot_release(uuid, uuid);
--   drop function if exists public.ai_slot_acquire(uuid, integer, integer);
--   drop table if exists public.ai_request_slots;

-- The foreign key below locks auth.users; never wait long for it.
set local lock_timeout = '5s';

-- 1. Leases -----------------------------------------------------------------------------------
create table if not exists public.ai_request_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);

comment on table public.ai_request_slots is
  'One row per /api/ai/* request in flight (a lease until expires_at). Written only by ai_slot_acquire/release/purge (028).';

-- Acquire counts and deletes by user; also serves the foreign key.
create index if not exists ai_request_slots_user_id_idx on public.ai_request_slots (user_id);
-- The purge scans by lease end.
create index if not exists ai_request_slots_expires_at_idx on public.ai_request_slots (expires_at);

alter table public.ai_request_slots enable row level security;

revoke all on table public.ai_request_slots from public, anon, authenticated;

-- 2. Acquire ----------------------------------------------------------------------------------
create or replace function public.ai_slot_acquire(p_user uuid, p_max integer, p_lease_seconds integer)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_now timestamptz;
  v_active integer;
  v_id uuid;
begin
  if p_user is null then
    raise exception 'ai_slot_acquire: p_user is required' using errcode = '22004';
  end if;
  if p_max is null or p_max not between 1 and 100 then
    raise exception 'ai_slot_acquire: p_max must be 1-100, got %', p_max using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 1 and 3600 then
    raise exception 'ai_slot_acquire: p_lease_seconds must be 1-3600, got %', p_lease_seconds
      using errcode = '22023';
  end if;
  -- The count below relies on seeing every lease committed by earlier lock holders.
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'ai_slot_acquire: must run under READ COMMITTED, not %',
      pg_catalog.current_setting('transaction_isolation')
      using errcode = '25001';
  end if;

  -- One caller per user at a time, until this transaction ends.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai_slot' || pg_catalog.chr(1) || p_user::text, 28)
  );
  -- Read the clock after the lock: a caller that waited must not judge leases by an older time.
  v_now := pg_catalog.clock_timestamp();

  -- Tidy this user's expired leases, skipping any the purge (or a release) holds right now.
  delete from public.ai_request_slots s
  where s.ctid = any (array(
    select x.ctid
    from public.ai_request_slots x
    where x.user_id = p_user and x.expires_at <= v_now
    for update skip locked
  ));

  -- Only live leases count, whether or not the delete above could take every expired one.
  select count(*)::integer into v_active
  from public.ai_request_slots s
  where s.user_id = p_user and s.expires_at > v_now;

  if v_active >= p_max then
    return null;
  end if;

  insert into public.ai_request_slots (user_id, expires_at)
  values (p_user, v_now + pg_catalog.make_interval(secs => p_lease_seconds))
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.ai_slot_acquire(uuid, integer, integer) is
  'Takes one of p_max concurrent AI request slots for p_user, leased for p_lease_seconds; returns its id, or NULL when all are taken. READ COMMITTED only. Service role only (028).';

revoke execute on function public.ai_slot_acquire(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_slot_acquire(uuid, integer, integer) to service_role;

-- 3. Release ----------------------------------------------------------------------------------
create or replace function public.ai_slot_release(p_user uuid, p_slot uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '1s'
as $$
declare
  v_deleted integer;
begin
  if p_user is null or p_slot is null then
    raise exception 'ai_slot_release: p_user and p_slot are required' using errcode = '22004';
  end if;
  delete from public.ai_request_slots s where s.id = p_slot and s.user_id = p_user;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

comment on function public.ai_slot_release(uuid, uuid) is
  'Releases an AI request slot of p_user; returns whether one was deleted. Service role only (028).';

revoke execute on function public.ai_slot_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_slot_release(uuid, uuid) to service_role;

-- 4. Purge expired leases ---------------------------------------------------------------------
create or replace function public.ai_slot_purge(p_limit integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := pg_catalog.clock_timestamp() - interval '1 hour';
  v_deleted integer;
begin
  if p_limit is null or p_limit not between 1 and 100000 then
    raise exception 'ai_slot_purge: p_limit must be 1-100000, got %', p_limit using errcode = '22023';
  end if;

  -- Rows an acquire or release holds right now are skipped, so this never waits on a lock.
  delete from public.ai_request_slots s
  where s.ctid = any (array(
    select x.ctid
    from public.ai_request_slots x
    where x.expires_at < v_cutoff
    order by x.expires_at
    limit p_limit
    for update skip locked
  ));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.ai_slot_purge(integer) is
  'Deletes up to p_limit AI request slots whose lease ended over an hour ago, skipping locked rows; returns the count. Run by pg_cron job ai-slot-purge. Service role only (028).';

revoke execute on function public.ai_slot_purge(integer) from public, anon, authenticated;
grant execute on function public.ai_slot_purge(integer) to service_role;

-- 5. Credits certainly used up ----------------------------------------------------------------
create or replace function public.ai_credits_exhausted(p_user uuid, p_month text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allowance integer;
  v_used integer;
begin
  if p_user is null then
    raise exception 'ai_credits_exhausted: p_user is required' using errcode = '22004';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'ai_credits_exhausted: p_month must be YYYY-MM, got %', p_month using errcode = '22023';
  end if;

  -- Any pack row for the month, in whatever state: not certain, let the reservation decide.
  if exists (
    select 1 from public.ai_credit_purchases p
    where p.user_id = p_user and p.month = p_month
  ) then
    return false;
  end if;

  -- A: the managed allowance as 027's ai_reserve_credits() counts it (active only). With no
  -- packs its cap is at most max(A, allowance_spent) and allowance_spent <= credits_used (027's
  -- CHECK), so used >= A means used >= cap. max() so a second matching row can only make this
  -- more permissive.
  select greatest(0, least(2147483647, coalesce((
           select max(s.ai_monthly_credits::bigint)
           from public.subscriptions s
           where s.user_id = p_user
             and s.tier = 'pro_ai'
             and s.ai_mode = 'managed'
             and s.status = 'active'
         ), 0)))::integer
    into v_allowance;

  select u.credits_used into v_used
  from public.ai_usage u
  where u.user_id = p_user and u.month = p_month;

  return coalesce(v_used, 0) >= v_allowance;
end;
$$;

comment on function public.ai_credits_exhausted(uuid, text) is
  'True only when a managed reservation for (p_user, p_month) would certainly be refused: no credit-pack row for the month and credits_used >= the active managed allowance. Never stricter than ai_reserve_credits() (027). Service role only (028).';

revoke execute on function public.ai_credits_exhausted(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_credits_exhausted(uuid, text) to service_role;

-- 6. Peek at a rate-limit bucket --------------------------------------------------------------
create or replace function public.rate_limit_peek(
  p_bucket text,
  p_key text,
  p_windows integer[],
  p_maxes integer[]
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_count integer;
  v_window integer;
  v_start timestamptz;
  v_hits integer;
  v_wait integer := 0;
begin
  if p_bucket is null or p_bucket !~ '^[a-z0-9_:-]{1,64}$' then
    raise exception 'rate_limit_peek: p_bucket must be 1-64 of [a-z0-9_:-], got %', p_bucket
      using errcode = '22023';
  end if;
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'rate_limit_peek: p_key must be 1-200 characters' using errcode = '22023';
  end if;
  v_count := coalesce(pg_catalog.array_length(p_windows, 1), 0);
  if v_count not between 1 and 5
     or coalesce(pg_catalog.array_length(p_maxes, 1), 0) <> v_count
     or pg_catalog.array_ndims(p_windows) <> 1 or pg_catalog.array_ndims(p_maxes) <> 1
     or pg_catalog.array_lower(p_windows, 1) <> 1 or pg_catalog.array_lower(p_maxes, 1) <> 1 then
    raise exception 'rate_limit_peek: p_windows and p_maxes must be one-dimensional with the same 1-5 elements'
      using errcode = '22023';
  end if;
  for i in 1..v_count loop
    if p_windows[i] is null or p_windows[i] not between 1 and 86400 then
      raise exception 'rate_limit_peek: window % must be 1-86400 seconds, got %', i, p_windows[i]
        using errcode = '22023';
    end if;
    if p_windows[i] = any (p_windows[1:i - 1]) then
      raise exception 'rate_limit_peek: window % (% seconds) is listed twice', i, p_windows[i]
        using errcode = '22023';
    end if;
    if p_maxes[i] is null or p_maxes[i] < 1 then
      raise exception 'rate_limit_peek: max % must be at least 1, got %', i, p_maxes[i]
        using errcode = '22023';
    end if;
  end loop;

  -- Only this caller's current window is read: a stored window newer than v_now (clock stepped
  -- back) is not matched and counts as room. rate_limit_take() refuses that case when counting.
  for i in 1..v_count loop
    v_window := p_windows[i];
    v_start := pg_catalog.to_timestamp(
      pg_catalog.floor(extract(epoch from v_now) / v_window) * v_window
    );
    select c.hits into v_hits
    from public.rate_limit_counters c
    where c.bucket = p_bucket and c.key = p_key and c.window_seconds = v_window
      and c.window_start = v_start;
    if coalesce(v_hits, 0) >= p_maxes[i] then
      v_wait := greatest(
        v_wait,
        1,
        pg_catalog.ceil(extract(epoch from (v_start + pg_catalog.make_interval(secs => v_window) - v_now)))::integer
      );
    end if;
  end loop;

  allowed := v_wait = 0;
  retry_after_seconds := v_wait;
  return next;
end;
$$;

comment on function public.rate_limit_peek(text, text, integer[], integer[]) is
  'Like rate_limit_take() (025/026) but counts nothing and takes no lock, so it is more lenient (concurrent peeks can all pass; a window newer than the clock counts as room): (allowed, retry_after_seconds) for (bucket, key) against fixed windows. rate_limit_take() still decides. Service role only (028).';

revoke execute on function public.rate_limit_peek(text, text, integer[], integer[]) from public, anon, authenticated;
grant execute on function public.rate_limit_peek(text, text, integer[], integer[]) to service_role;

-- 7. Schedule the purge -----------------------------------------------------------------------
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'ai-slot-purge',
  '*/10 * * * *',
  $cron$select public.ai_slot_purge(5000)$cron$
);
-- A re-run must not leave a job someone disabled switched off.
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'ai-slot-purge';

-- 8. End-state check --------------------------------------------------------------------------
do $$
declare
  api_role text;
  priv text;
  fn regprocedure;
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.ai_request_slots'::regclass and relrowsecurity
  ) then
    raise exception 'ai_request_slots: row level security is not enabled';
  end if;

  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'ai_request_slots') then
    raise exception 'ai_request_slots: has a policy; it must have none';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c,
         pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    where c.oid = 'public.ai_request_slots'::regclass and a.grantee = 0
  ) then
    raise exception 'ai_request_slots: PUBLIC holds a privilege on it';
  end if;

  foreach api_role in array array['anon', 'authenticated'] loop
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(api_role, 'public.ai_request_slots', priv) then
        raise exception 'ai_request_slots: role % still holds %', api_role, priv;
      end if;
    end loop;
    if has_any_column_privilege(api_role, 'public.ai_request_slots', 'SELECT, INSERT, UPDATE, REFERENCES') then
      raise exception 'ai_request_slots: role % holds a column privilege', api_role;
    end if;
  end loop;

  foreach fn in array array[
    'public.ai_slot_acquire(uuid, integer, integer)'::regprocedure,
    'public.ai_slot_release(uuid, uuid)'::regprocedure,
    'public.ai_slot_purge(integer)'::regprocedure,
    'public.ai_credits_exhausted(uuid, text)'::regprocedure,
    'public.rate_limit_peek(text, text, integer[], integer[])'::regprocedure
  ] loop
    if exists (
      select 1
      from pg_catalog.pg_proc p,
           pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      where p.oid = fn and a.grantee = 0
    ) then
      raise exception '%: PUBLIC can execute it', fn;
    end if;
    foreach api_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(api_role, fn, 'EXECUTE') then
        raise exception '%: role % can execute it', fn, api_role;
      end if;
    end loop;
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

  foreach fn in array array[
    'public.ai_slot_acquire(uuid, integer, integer)'::regprocedure,
    'public.ai_slot_release(uuid, uuid)'::regprocedure
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_proc where oid = fn and proconfig @> array['lock_timeout=1s']
    ) then
      raise exception '%: lock_timeout must be 1s', fn;
    end if;
  end loop;

  -- ai_credits_exhausted() is only safe while allowance_spent <= credits_used holds (027).
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ai_usage'::regclass
      and conname = 'ai_usage_allowance_spent_check'
      and contype = 'c'
  ) then
    raise exception 'ai_usage_allowance_spent_check (027) is missing; ai_credits_exhausted relies on it';
  end if;

  if not exists (
    select 1 from cron.job
    where jobname = 'ai-slot-purge'
      and schedule = '*/10 * * * *'
      and command = 'select public.ai_slot_purge(5000)'
      and active
  ) then
    raise exception 'pg_cron job ai-slot-purge is missing or differs';
  end if;
end;
$$;
