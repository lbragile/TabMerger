-- 027_ai_credit_revocation_and_past_due_allowance.sql
--
-- Two changes to what managed Pro AI may spend (ai_reserve_credits, migration 022):
--
-- A. A credit pack whose payment was disputed or refunded stops counting. The Stripe webhook
--    sets ai_credit_purchases.revoked_at while the pack's charge is contested (an open or lost
--    dispute) or fully refunded, and clears it again when the dispute is won. The row is kept
--    (its credits and session id stay as they were, so the purchase history and the webhook's
--    idempotency on stripe_checkout_session_id are unchanged); ai_reserve_credits only adds
--    packs whose revoked_at is null. Credits already spent can't be taken back: the counter
--    keeps them, and the cap simply drops by the pack, so no new spend is allowed until usage is
--    back under it.
--
-- B. No new managed credits unless the subscription is `active`. The webhook writes
--    subscriptions.ai_monthly_credits = 0 for any other status (past_due included), and
--    ai_reserve_credits counts the allowance only for status `active`, while past_due stays
--    entitled for sync, the rest of Pro and credit packs. ai_usage.credits_used is one counter
--    for the allowance and the month's credit packs (the allowance is spent first), so dropping
--    the allowance to 0 alone would also swallow the packs of a user who had already used some
--    allowance. So when ai_monthly_credits drops from a positive value to 0 on an entitled
--    managed pro_ai row, a trigger records on this month's ai_usage row how much of the usage
--    the allowance paid for (allowance_spent). ai_reserve_credits then caps at
--    greatest(allowance if active, allowance_spent) + unrevoked packs: what the allowance
--    already paid for stays paid for, nothing more is granted from it, and the packs keep
--    exactly their unspent part. A later month has no allowance_spent (0). When the payment
--    recovers, the webhook writes the allowance back and it outweighs allowance_spent again.
--
-- What this does:
--   1. ai_usage.allowance_spent integer (null = never frozen), check
--      0 <= allowance_spent <= credits_used (ai_usage_allowance_spent_check).
--   2. ai_credit_purchases.revoked_at timestamptz (null = counts).
--   3. Trigger subscriptions_freeze_ai_allowance: AFTER UPDATE OF ai_monthly_credits, when it
--      goes from > 0 to 0 on a row that was pro_ai + managed + entitled, sets allowance_spent on
--      the user's ai_usage row for the current UTC month (the month key lib/ai-usage.ts
--      currentMonth() uses), never lowering a value already recorded that month. No row (nothing
--      used this month) = nothing to record.
--   4. Trigger ai_usage_clamp_allowance_spent: BEFORE UPDATE OF credits_used, allowance_spent,
--      keeps allowance_spent <= credits_used. A settlement (ai_settle_credits) can lower
--      credits_used below the figure recorded while a reservation was still in flight; the
--      allowance can't have paid for more than was finally used. With the check in 1, the
--      invariant allowance_spent <= credits_used holds on every row, so allowance_spent alone
--      never opens any headroom.
--   5. ai_reserve_credits: the new cap, and a FOR SHARE lock on the user's subscriptions row
--      first, so a reservation never uses an allowance a concurrent freeze is replacing.
--      Signature, return shape and grants unchanged.
--   6. Checks the end state and fails the migration if it is not the one described above.
--
-- Known limitation: the freeze fires only on a drop to 0. An allowance lowered to a positive
-- value (a coupon added mid-period) caps the month at the new figure even when more of the old
-- one was already used; nothing over-grants, the user just gets less this month.
--
-- Locks while this runs: the live ai_reserve_credits is still 022's until this commits, and it
-- reads subscriptions and ai_credit_purchases, then upserts ai_usage. An account deletion
-- cascades from auth.users through profiles to subscriptions before ai_usage and
-- ai_credit_purchases. So every lock this file needs is taken up front in that same order:
-- subscriptions in SHARE ROW EXCLUSIVE (what CREATE TRIGGER needs; it still lets the RLS reads
-- of has_cloud_sync() through and only holds back subscriptions writes), then
-- ai_credit_purchases and ai_usage in ACCESS EXCLUSIVE (the ALTERs). Taking ai_usage before
-- ai_credit_purchases, or the trigger lock on subscriptions last, deadlocks (40P01) with a
-- reservation or a deletion caught in between; in this order the migration only waits, at most
-- lock_timeout (5s), then fails without changing anything.
--
-- Re-running: `if not exists` columns, a guarded constraint, `create or replace` functions and
-- triggers (no DROP TRIGGER: that takes ACCESS EXCLUSIVE on subscriptions, which every sync
-- write's RLS reads, and could deadlock with ai_reserve_credits).
--
-- Rollback, in this order:
--   1. Roll back 028 first (or at least the web code that calls ai_credits_exhausted): its
--      "certainly exhausted" answer counts the allowance for `active` only and relies on this
--      file's ai_usage_allowance_spent_check. Without 027, ai_reserve_credits is 022's again
--      (allowance for trialing and past_due too), so that pre-check would refuse requests the
--      reservation allows.
--   2. Roll the web code back (the webhook writes revoked_at; lib/creditPacks.ts and
--      lib/paymentReversals.ts would fail every dispute event without the column).
--   3. Export the revoked packs, which count again once the column is gone:
--        copy (select id, user_id, month, credits, stripe_checkout_session_id, revoked_at
--                from public.ai_credit_purchases where revoked_at is not null) to stdout csv header;
--   4. In one transaction (LOCK TABLE needs one; the locks follow the order above, and DROP
--      TRIGGER needs ACCESS EXCLUSIVE on subscriptions, so fail fast rather than queue every
--      sync write behind it):
--        begin;
--        set local lock_timeout = '5s';
--        lock table public.subscriptions, public.ai_credit_purchases, public.ai_usage
--          in access exclusive mode;
--      then re-run section 2 of 022_ai_byok_and_cost_credits.sql (its ai_reserve_credits,
--      comment, revoke and grant), then:
--        drop trigger if exists subscriptions_freeze_ai_allowance on public.subscriptions;
--        drop trigger if exists ai_usage_clamp_allowance_spent on public.ai_usage;
--        drop function if exists public.freeze_ai_allowance();
--        drop function if exists public.clamp_ai_allowance_spent();
--        alter table public.ai_usage drop column if exists allowance_spent;
--        alter table public.ai_credit_purchases drop column if exists revoked_at;
--        commit;

set local lock_timeout = '5s';

-- Every lock up front, in the order the live 022 ai_reserve_credits and an account deletion take
-- them (see "Locks while this runs" above).
lock table public.subscriptions in share row exclusive mode;
lock table public.ai_credit_purchases, public.ai_usage in access exclusive mode;

-- 1. Allowance already spent when the allowance stopped -----------------------------------------
alter table public.ai_usage
  add column if not exists allowance_spent integer;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ai_usage'::regclass and conname = 'ai_usage_allowance_spent_check'
  ) then
    alter table public.ai_usage
      add constraint ai_usage_allowance_spent_check
      check (allowance_spent >= 0 and allowance_spent <= credits_used);
  end if;
end;
$$;

comment on column public.ai_usage.allowance_spent is
  'Credits of this month''s usage the managed allowance paid for, recorded when subscriptions.ai_monthly_credits dropped to 0 (e.g. past_due). 0 <= allowance_spent <= credits_used. ai_reserve_credits caps at greatest(allowance if active, allowance_spent) + unrevoked packs.';

-- 2. Revoked credit packs ---------------------------------------------------------------------
alter table public.ai_credit_purchases
  add column if not exists revoked_at timestamptz;

comment on column public.ai_credit_purchases.revoked_at is
  'Set by the Stripe webhook while the pack''s payment is disputed (open or lost) or fully refunded; null = the credits count. ai_reserve_credits ignores revoked packs.';

-- 3. Freeze trigger on subscriptions ----------------------------------------------------------
-- Not security definer: only the service role (webhook, re-sync script) and the owner write
-- subscriptions.ai_monthly_credits, and both may update ai_usage themselves. If another role ever
-- could, the trigger failing for it is the safer outcome.
create or replace function public.freeze_ai_allowance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.ai_usage u
     set allowance_spent = greatest(coalesce(u.allowance_spent, 0),
                                    least(old.ai_monthly_credits, u.credits_used))
   where u.user_id = new.user_id
     and u.month = to_char(now() at time zone 'utc', 'YYYY-MM');
  return null;
end;
$$;

comment on function public.freeze_ai_allowance() is
  'Trigger: when subscriptions.ai_monthly_credits drops from > 0 to 0 on an entitled managed pro_ai row, records on this month''s ai_usage row how much of the usage the allowance paid for (allowance_spent), never lowering it.';

revoke execute on function public.freeze_ai_allowance() from public, anon, authenticated;

-- The status list is ENTITLED_SUBSCRIPTION_STATUSES (packages/shared), checked by
-- entitledStatusesSqlDrift.test.ts. Only an entitled managed pro_ai row could ever spend from
-- its allowance, so only its drop is frozen: an incomplete or ended row with a stale positive
-- allowance never paid for anything and must not get it back as allowance_spent. past_due stays
-- in the list on purpose: before this migration ai_reserve_credits counted the allowance for
-- past_due, so a row that is past_due at deploy time was spending from it, and the re-sync that
-- zeroes it (scripts/resync-ai-allowance.ts) has to freeze that spending or its packs would look
-- used up. trialing rows always hold 0, so for them the clause never fires.
create or replace trigger subscriptions_freeze_ai_allowance
  after update of ai_monthly_credits on public.subscriptions
  for each row
  when (
    old.ai_monthly_credits > 0
    and new.ai_monthly_credits = 0
    and old.tier = 'pro_ai'
    and old.ai_mode = 'managed'
    and old.status in ('active', 'trialing', 'past_due')
  )
  execute function public.freeze_ai_allowance();

-- 4. Clamp trigger on ai_usage ----------------------------------------------------------------
create or replace function public.clamp_ai_allowance_spent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.allowance_spent := least(new.allowance_spent, new.credits_used);
  return new;
end;
$$;

comment on function public.clamp_ai_allowance_spent() is
  'Trigger: keeps ai_usage.allowance_spent <= credits_used when a settlement lowers credits_used.';

revoke execute on function public.clamp_ai_allowance_spent() from public, anon, authenticated;

create or replace trigger ai_usage_clamp_allowance_spent
  before update of credits_used, allowance_spent on public.ai_usage
  for each row
  when (new.allowance_spent is not null and new.credits_used < new.allowance_spent)
  execute function public.clamp_ai_allowance_spent();

-- 5. ai_reserve_credits -----------------------------------------------------------------------
-- As in 022, with these changes:
--   - the user's subscriptions row is locked FOR SHARE first. A webhook write of that row (and
--     the freeze trigger it fires) holds a row lock until it commits, so the reservation waits
--     and then reads the new allowance and allowance_spent together, never the old allowance next
--     to a fresh allowance_spent. Same lock order as the webhook: subscriptions, then ai_usage;
--   - the allowance counts only for status 'active' (no new managed credits while past_due or
--     trialing); allowance_spent and unrevoked packs count whatever the status (the AI routes
--     decide who may call at all);
--   - cap = greatest(allowance, this month's allowance_spent) + unrevoked packs.
-- allowance_spent <= credits_used (sections 1 and 4), so with no unrevoked packs the cap allows
-- a reservation exactly when the active allowance alone would.
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

  perform 1 from public.subscriptions where user_id = p_user for share;

  select greatest(0, least(2147483647,
           greatest(
             coalesce((
               select s.ai_monthly_credits::bigint
               from public.subscriptions s
               where s.user_id = p_user
                 and s.tier = 'pro_ai'
                 and s.ai_mode = 'managed'
                 and s.status = 'active'
             ), 0),
             coalesce((
               select a.allowance_spent::bigint
               from public.ai_usage a
               where a.user_id = p_user
                 and a.month = p_month
             ), 0)
           )
           + coalesce((
             select sum(p.credits)
             from public.ai_credit_purchases p
             where p.user_id = p_user
               and p.month = p_month
               and p.revoked_at is null
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
  'Service role only. Atomically adds p_amount to ai_usage.credits_used for (p_user, p_month) if it stays within the cap (greatest(managed allowance if active, allowance_spent) + unrevoked credit packs); returns allowed, remaining, cap.';

revoke execute on function public.ai_reserve_credits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_credits(uuid, text, integer) to service_role;

-- 6. End-state check --------------------------------------------------------------------------
do $$
declare
  api_role text;
  fn text;
  def text;
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.ai_credit_purchases'::regclass
      and a.attname = 'revoked_at' and not a.attisdropped and not a.attnotnull
      and a.atttypid = 'timestamptz'::regtype
  ) then
    raise exception 'public.ai_credit_purchases.revoked_at (nullable timestamptz) is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.ai_usage'::regclass
      and a.attname = 'allowance_spent' and not a.attisdropped and not a.attnotnull
      and a.atttypid = 'integer'::regtype
  ) then
    raise exception 'public.ai_usage.allowance_spent (nullable integer) is missing';
  end if;

  select pg_catalog.pg_get_constraintdef(c.oid) into def
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.ai_usage'::regclass
    and c.conname = 'ai_usage_allowance_spent_check' and c.contype = 'c' and c.convalidated;
  if def is null or position('credits_used' in def) = 0 then
    raise exception 'public.ai_usage: check ai_usage_allowance_spent_check (0 <= allowance_spent <= credits_used) is missing';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.subscriptions'::regclass
      and t.tgname = 'subscriptions_freeze_ai_allowance' and t.tgenabled = 'O'
      and t.tgfoid = 'public.freeze_ai_allowance()'::regprocedure
      and position('old.status' in pg_catalog.pg_get_triggerdef(t.oid)) > 0
  ) then
    raise exception 'trigger subscriptions_freeze_ai_allowance is missing, disabled or not status-filtered';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ai_usage'::regclass
      and t.tgname = 'ai_usage_clamp_allowance_spent' and t.tgenabled = 'O'
      and t.tgfoid = 'public.clamp_ai_allowance_spent()'::regprocedure
  ) then
    raise exception 'trigger ai_usage_clamp_allowance_spent is missing or disabled';
  end if;

  def := pg_catalog.pg_get_functiondef('public.ai_reserve_credits(uuid, text, integer)'::regprocedure);
  if position('revoked_at is null' in def) = 0
     or position('allowance_spent' in def) = 0
     or position('for share' in def) = 0 then
    raise exception 'public.ai_reserve_credits is not the 027 version';
  end if;

  fn := 'public.ai_reserve_credits(uuid, text, integer)';
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(api_role, fn, 'EXECUTE') then
      raise exception '%: role % can still execute it', fn, api_role;
    end if;
    if has_column_privilege(api_role, 'public.ai_usage', 'allowance_spent', 'UPDATE')
       or has_column_privilege(api_role, 'public.ai_credit_purchases', 'revoked_at', 'UPDATE') then
      raise exception 'role % can write a 027 column', api_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', fn, 'EXECUTE') then
    raise exception '%: service_role cannot execute it', fn;
  end if;
end;
$$;
