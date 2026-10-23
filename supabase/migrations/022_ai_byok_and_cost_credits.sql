-- 022_ai_byok_and_cost_credits.sql
--
-- Pro AI gets two options on the same `pro_ai` tier: "managed" (TabMerger pays for AI up to a
-- monthly credit allowance) and "byok" (the customer brings their own Anthropic key and pays
-- Anthropic directly). Credits become a cost unit: 1 credit = USD 0.001 of AI list-price cost.
-- AI routes reserve the worst-case cost of a call before it runs and settle to the real cost
-- afterwards, through two service-role-only functions that do the check and the increment in
-- one statement.
--
-- What this does:
--   1. subscriptions.ai_mode ('managed' | 'byok', default 'managed') and
--      subscriptions.ai_monthly_credits (integer >= 0, default 0). Both are written only by the
--      Stripe webhook (service role). subscriptions keeps "subscriptions_select_own" as its only
--      policy, so a signed-in user reads both columns on their own row and cannot write them.
--   2. public.ai_reserve_credits(p_user, p_month, p_amount): adds p_amount to
--      ai_usage.credits_used for that user and month only if the result stays within the cap,
--      and returns (allowed, remaining, cap). Cap = ai_monthly_credits when the subscription is
--      pro_ai + managed + an entitled status, else 0, plus that month's credit packs.
--   3. public.ai_settle_credits(p_user, p_month, p_delta): adds p_delta (usually negative) to
--      credits_used, never below 0, and returns the new value (null when there is no row).
--   4. Converts existing ai_credit_purchases.credits to the new unit (see section 4).
--   5. Checks the end state and fails the migration if it is not the one described above.
--
-- Entitled statuses: `s.status in ('active', 'trialing', 'past_due')` in ai_reserve_credits
-- mirrors ENTITLED_SUBSCRIPTION_STATUSES in packages/shared/src/constants/index.ts, the same
-- list has_cloud_sync() (019) uses. The extension test entitledStatusesSqlDrift.test.ts checks
-- both functions against that constant; change all three together.
--
-- ai_usage rows are left as they are (they hold the old weighted units).
--
-- Manual credit grants (no UI): insert an ai_credit_purchases row whose
-- stripe_checkout_session_id is 'grant_' || gen_random_uuid(). That column is unique text with
-- no format check, so grant ids and Stripe session ids share it without colliding.
--
-- Re-running: the columns use `if not exists`, the functions `create or replace`, and the
-- pack conversion runs only while the credits column does not yet carry the comment this
-- migration sets on it, so a second run by hand does not convert the packs twice.
--
-- Rollback (pack credits come back exactly for every old pack of 7 or more units; smaller
-- packs were clamped to 0 and cannot be recovered):
--   drop function if exists public.ai_settle_credits(uuid, text, integer);
--   drop function if exists public.ai_reserve_credits(uuid, text, integer);
--   alter table public.subscriptions
--     drop column if exists ai_monthly_credits,
--     drop column if exists ai_mode;
--   update public.ai_credit_purchases set credits = ceil((credits + 120) / 18.8)::integer;
--   comment on column public.ai_credit_purchases.credits is null;

-- 1. subscriptions: AI option and monthly allowance ----------------------------------------
alter table public.subscriptions
  add column if not exists ai_mode text not null default 'managed'
    constraint subscriptions_ai_mode_check check (ai_mode in ('managed', 'byok')),
  add column if not exists ai_monthly_credits integer not null default 0
    constraint subscriptions_ai_monthly_credits_check check (ai_monthly_credits >= 0);

comment on column public.subscriptions.ai_mode is
  'Pro AI option: managed (TabMerger key, metered in credits) or byok (customer key, not metered). Written by the Stripe webhook.';
comment on column public.subscriptions.ai_monthly_credits is
  'Managed Pro AI allowance per month in credits (1 credit = USD 0.001 of AI cost). 0 for byok and non-AI plans. Written by the Stripe webhook.';

-- 2. ai_reserve_credits ---------------------------------------------------------------------
-- Atomicity: the check and the increment are one INSERT ... ON CONFLICT DO UPDATE ... WHERE.
-- On conflict Postgres locks the existing ai_usage row and evaluates the WHERE against its
-- latest committed version, so a concurrent reservation for the same user and month waits
-- for the first one to commit and then sees its credits_used. Two calls can never both pass
-- on the same headroom. A first-ever call for a month inserts the row only when p_amount fits
-- the cap; a concurrent first call takes the conflict path after the insert commits.
create or replace function public.ai_reserve_credits(p_user uuid, p_month text, p_amount integer)
returns table (allowed boolean, remaining integer, cap integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_used integer;
begin
  if p_user is null then
    raise exception 'ai_reserve_credits: p_user is required' using errcode = '22004';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ai_reserve_credits: p_amount must be a positive integer, got %', p_amount
      using errcode = '22023';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'ai_reserve_credits: p_month must be YYYY-MM, got %', p_month
      using errcode = '22023';
  end if;

  select greatest(0, least(2147483647,
           coalesce((
             select s.ai_monthly_credits::bigint
             from public.subscriptions s
             where s.user_id = p_user
               and s.tier = 'pro_ai'
               and s.ai_mode = 'managed'
               and s.status in ('active', 'trialing', 'past_due')
           ), 0)
           + coalesce((
             select sum(p.credits)
             from public.ai_credit_purchases p
             where p.user_id = p_user
               and p.month = p_month
           ), 0)
         ))::integer
    into v_cap;

  insert into public.ai_usage as u (user_id, month, credits_used)
  select p_user, p_month, p_amount
  where p_amount <= v_cap
  on conflict (user_id, month) do update
    set credits_used = u.credits_used + excluded.credits_used
    where u.credits_used::bigint + excluded.credits_used <= v_cap
  returning u.credits_used into v_used;

  if found then
    allowed := true;
    remaining := v_cap - v_used;
    cap := v_cap;
    return next;
    return;
  end if;

  select u.credits_used into v_used
  from public.ai_usage u
  where u.user_id = p_user and u.month = p_month;

  allowed := false;
  remaining := greatest(0, v_cap::bigint - coalesce(v_used, 0))::integer;
  cap := v_cap;
  return next;
end;
$$;

comment on function public.ai_reserve_credits(uuid, text, integer) is
  'Service role only. Atomically adds p_amount to ai_usage.credits_used for (p_user, p_month) if it stays within the cap; returns allowed, remaining, cap.';

revoke execute on function public.ai_reserve_credits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_credits(uuid, text, integer) to service_role;

-- 3. ai_settle_credits ----------------------------------------------------------------------
-- One UPDATE, so it is atomic against concurrent reserves and settles (row lock).
create or replace function public.ai_settle_credits(p_user uuid, p_month text, p_delta integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_user is null then
    raise exception 'ai_settle_credits: p_user is required' using errcode = '22004';
  end if;
  if p_delta is null then
    raise exception 'ai_settle_credits: p_delta is required' using errcode = '22004';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'ai_settle_credits: p_month must be YYYY-MM, got %', p_month
      using errcode = '22023';
  end if;

  update public.ai_usage u
     set credits_used = greatest(0, least(2147483647, u.credits_used::bigint + p_delta))::integer
   where u.user_id = p_user
     and u.month = p_month
  returning u.credits_used into v_used;

  return v_used;
end;
$$;

comment on function public.ai_settle_credits(uuid, text, integer) is
  'Service role only. Adds p_delta (usually negative) to ai_usage.credits_used for (p_user, p_month), never below 0; returns the new value, or null when there is no row.';

revoke execute on function public.ai_settle_credits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_settle_credits(uuid, text, integer) to service_role;

-- 4. Existing credit packs to the new unit ---------------------------------------------------
-- Old rows store units bought at USD 0.05 each. New credits = 40% of the net revenue
-- (6% + USD 0.30 payment fees) in USD 0.001 steps, floored and never negative:
--   floor(0.40 * (units * 0.05 * 0.94 - 0.30) / 0.001) = floor(18.8 * units - 120)
-- e.g. the 50-unit minimum pack (USD 2.50) becomes 820 credits. credits has no check
-- constraint, so a row clamped to 0 stays valid.
do $$
declare
  marker constant text :=
    'Credits granted by this purchase. Unit since migration 022: 1 credit = USD 0.001 of AI cost.';
begin
  if pg_catalog.col_description(
       'public.ai_credit_purchases'::regclass,
       (select a.attnum from pg_catalog.pg_attribute a
         where a.attrelid = 'public.ai_credit_purchases'::regclass and a.attname = 'credits')
     ) is distinct from marker then
    update public.ai_credit_purchases
       set credits = greatest(0, floor(0.40 * (credits * 0.05 * 0.94 - 0.30) / 0.001))::integer;
    execute format('comment on column public.ai_credit_purchases.credits is %L', marker);
  end if;
end;
$$;

-- 5. End-state check ------------------------------------------------------------------------
do $$
declare
  fn text;
  api_role text;
  extra_policy text;
begin
  foreach fn in array array[
    'public.ai_reserve_credits(uuid, text, integer)',
    'public.ai_settle_credits(uuid, text, integer)'
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(api_role, fn, 'EXECUTE') then
        raise exception '%: role % can still execute it', fn, api_role;
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '%: service_role cannot execute it', fn;
    end if;
  end loop;

  -- The new columns and the counters are server-written only: no table the two functions
  -- read or write may carry a client write policy.
  select tablename || '."' || policyname || '"' into extra_policy
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename in ('subscriptions', 'ai_usage', 'ai_credit_purchases')
    and cmd <> 'SELECT'
  limit 1;

  if extra_policy is not null then
    raise exception 'unexpected non-select policy %', extra_policy;
  end if;
end;
$$;
