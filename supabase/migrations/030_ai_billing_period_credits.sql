-- 030_ai_billing_period_credits.sql (runs after 029_ai_credit_purchases_carried_from_month.sql)
--
-- Two fixes to managed AI credits:
--
-- A. Credits reset when a paid billing period starts, not on the 1st. ai_usage and
--    ai_credit_purchases are keyed by a 'YYYY-MM' month. Until now that was the UTC calendar month,
--    so one payment could fund two allowances: subscribe on Oct 31, spend the allowance that day
--    and again on Nov 1, and about 69% of the payment goes to AI cost against a 40% target. A
--    mid-period upgrade's proportional allowance doubled the same way. The key keeps its format
--    (p_month validation and existing rows stay valid), but it now means the UTC calendar month in
--    which the current allowance month STARTED:
--      - a monthly period (at most 32 days): the month of its start. Stripe keeps one period start
--        per calendar month (anchor 31: Jan 31, Feb 28, Mar 31), so each period has its own key;
--      - a longer period (yearly, the Price pays for 12 monthly allowances): the month of the
--        latest monthly anniversary of the start that has passed and lies before the end,
--        clamped to the month's end and counted from the start (Oct 31 -> Nov 30 -> Dec 31);
--      - no stored period (a row with no paid subscription behind it, or not yet re-synced): the UTC
--        calendar month, as before.
--    A period that has ended with no renewal stored keeps its key. Stripe moves the period about
--    an hour before it charges the renewal, so the web app stores a renewal's period only once its
--    invoice is paid (findUnpaidRenewal() in lib/aiAllowance.ts, `invoice.paid`): no new bucket
--    opens on a card that then fails. The web app and the extension compute the key with aiAllowanceMonth() in
--    packages/shared/src/utils/aiAllowanceMonth.ts; the pgTAP file for this migration holds the
--    case table both implementations are checked against.
--
-- B. ai_settle_credits no longer raises credits_used past the cap. A positive delta (the real cost
--    came out above the reservation) can raise it up to the cap ai_reserve_credits computes and no
--    further, and never lowers a value that is already over it. Negative deltas are unchanged.
--
-- What this does:
--   1. subscriptions.ai_period_start and ai_period_end (nullable timestamptz), written by the
--      Stripe webhook and the re-sync script from the subscription item's current period, except that
--      a renewal's new period waits for payment. A check keeps them both set or both null
--      (subscriptions_ai_period_pair_check). The
--      table-level revokes of 023 already leave anon and authenticated without write privileges
--      on new columns; the end-state check below proves it.
--   2. public.ai_allowance_month(p_start, p_end, p_now): the key, in SQL.
--   3. Trigger subscriptions_keep_ai_period: BEFORE UPDATE OF the two columns. For the same
--      subscription id, a start older than the stored one (or none) leaves both as they are. A
--      webhook writes what it just retrieved from Stripe, so a handler that read before a renewal
--      and wrote after it must not move the period backwards. A different id (a new subscription
--      taking over the user's one row) takes its own period.
--   4. freeze_ai_allowance(): stamps allowance_spent on the key computed from the row's OLD period
--      values. A single webhook write can set a new period and an allowance of 0 together (a plan
--      ending right after a renewal); what the allowance paid for lives on the old key's row, and the
--      new key's row owes it nothing. Its trigger and WHEN clause (027) are unchanged.
--   5. public.ai_credit_cap(p_user, p_month): the cap expression of ai_reserve_credits (027), moved
--      as it was into one function. ai_reserve_credits keeps its signature, return shape, grants
--      and lock, and calls it. ai_credits_exhausted (028) is untouched and stays never stricter:
--      the cap's value for every input is what it was.
--   6. ai_settle_credits: as above. A positive delta takes the FOR SHARE lock on the subscriptions
--      row first, the same order as ai_reserve_credits and the webhook (subscriptions, then
--      ai_usage). A negative delta takes no such lock, as before.
--   7. Trigger subscriptions_carry_ai_packs: AFTER UPDATE OF ai_period_start, when the start moves
--      forward. A pack bought after the stored period ended (while its renewal awaits payment) is
--      granted on the old key, so it is spendable at once. When the period then advances, the unspent
--      part of such a pack moves to the new key, so the reset doesn't take a pack bought for the
--      period that is just starting. When the old period was cut short (monthly to yearly on the same
--      id, or a new subscription taking over the row before the old period's end) every pack on the old
--      key qualifies: it was bought for time the old period no longer has. The allowance and older
--      packs are spent first, so the unspent part is what is left under the old key's cap, given to the
--      newest qualifying packs first. Each pack row moves whole, its `credits` lowered to the unspent
--      part and carried_from_month (migration 029) set, so a lowered row can be found. A pack with nothing unspent stays. A pack bought before a period that ran its full length
--      ended still ends with it. Nothing moves twice for one write: the row leaves the old key.
--   8. public.ai_grant_credit_pack(p_user, p_session, p_credits, p_revoked): reads the buyer's key and
--      inserts the pack in one call, under a FOR SHARE lock on the subscriptions row (subscriptions,
--      then ai_credit_purchases), so a grant racing a period advance can't land on the old key after
--      the carry ran. An existing row for the session is a no-op (false), revoked or not. With no
--      subscription row, the UTC calendar month.
--   9. Checks the end state and fails the migration if it is not the one described above.
--
-- Accepted consequences:
--   - No data is rewritten. Rows keep their months; a user's key moves when their period is first
--     stored, and that one move goes either way for a subscriber part-way through a period. If the key
--     lands on an older row or one already holding usage, that usage counts against them for one
--     period. If it lands on a month whose calendar row holds little or nothing, what they spent on
--     another calendar row no longer counts, so they can get up to one extra allowance, once. After
--     that first write, no write gives anyone a second allowance for one payment.
--   - Cancelling and resubscribing in the same calendar month gives the same key, so the usage
--     carries over.
--   - Unused allowance and packs end at the reset, the same as they did on the 1st, except packs
--     carried by step 7.
--   - A call in flight across a period advance settles on the key it reserved on. A refund to the old
--     row (a negative settlement) stays behind there: the new key isn't credited with it.
--   - A pack restored after a won dispute stays on its key, usually a bucket already gone.
--
-- Transaction: the file opens its own (`begin;` ... `commit;`). The Supabase CLI (db push,
-- migration up) sends a file's statements as one batch that is not a transaction block, so without
-- it LOCK TABLE fails (25P01) and `set local` warns and can't be relied on. Inside the block every
-- statement, the end-state check included, commits or rolls back together; on any error the CLI
-- stops before it records the version.
--
-- Locks while this runs: one ACCESS EXCLUSIVE lock, on subscriptions, the only table this file alters.
-- The RLS reads of has_cloud_sync() wait behind it, so lock_timeout (5s) makes a blocked migration fail
-- without changing anything rather than queue every sync write. Replacing a function locks no table, and
-- the end-state check reads catalogs. 029 takes its one lock in its own transaction: taken together, the
-- two locks deadlocked with ai_credits_exhausted (028), which reads ai_credit_purchases and then
-- subscriptions (reproduced locally; this split passes the same two-session test). A session holding
-- ai_credit_purchases that then reads subscriptions just waits for this commit. The new nullable columns
-- rewrite nothing; the one new check scans subscriptions, one row per user. Locks last milliseconds.
--
-- Deadlocks at run time, tested locally in pairs (a two-session script: grant, revoke, reservation and
-- settlement against a period advance with the carry, and ai_credits_exhausted against these
-- migrations). None of those pairs deadlocks. One pair can, and it is safe: a grant holds FOR SHARE on
-- the subscriptions row and its insert needs a key share on auth.users, while an account deletion holds
-- the auth.users row and waits on subscriptions. Postgres ends one of them. If the grant goes, the
-- webhook answers 500 and Stripe's retry fails a foreign key against the deleted user, which is harmless:
-- the account and its packs are gone. If the deletion goes, it is retried by whoever asked.
--
-- Re-running: `if not exists` columns, a guarded constraint, `create or replace` functions and
-- triggers (no DROP TRIGGER: see 027), idempotent grants.
--
-- Deploy order: 030 strictly first. New web code writes the period columns on every subscription
-- write, and PostgREST refuses an unknown column (PGRST204, checked locally), so without 030 every
-- subscription write fails with 500, and every AI request with 403. Release a store build of the
-- extension only after 030 is on production: it selects the columns too. Old code works with 030 in
-- place.
--
-- Rollback, in this order:
--   1. Roll the web code back first. It selects the new columns on every AI request and fails
--      closed (403) without them; old code ignores them and works with this migration in place.
--   2. Check for rows it can't put back, while the data still says what happened:
--        select id, user_id, month, carried_from_month, credits from public.ai_credit_purchases
--         where carried_from_month is not null;
--   3. In one explicit transaction, run as written in psql or the SQL editor (LOCK TABLE and
--      `set local` need a transaction block). It touches subscriptions only:
--        begin;
--        set local lock_timeout = '5s';
--        lock table public.subscriptions in access exclusive mode;
--      then re-run from 027 its section 3 (freeze_ai_allowance only) and section 5
--      (ai_reserve_credits, comment, revoke and grant), and from 022 its section 3
--      (ai_settle_credits, comment, revoke and grant), then:
--        drop trigger if exists subscriptions_carry_ai_packs on public.subscriptions;
--        drop function if exists public.carry_ai_packs_forward();
--        drop trigger if exists subscriptions_keep_ai_period on public.subscriptions;
--        drop function if exists public.keep_ai_period();
--        drop function if exists public.ai_grant_credit_pack(uuid, text, integer, boolean);
--        drop function if exists public.ai_credit_cap(uuid, text);
--        drop function if exists public.ai_allowance_month(timestamptz, timestamptz, timestamptz);
--        commit;
--      After this step an installed extension can show stale usage until step 4 (it still reads the
--      period columns, which nothing writes any more).
--   4. Later, as a separate step, once no deployed web code and no store build of the extension
--      reads the columns (an extension update can take days to reach everyone). This also rolls back 029:
--        begin;
--        set local lock_timeout = '5s';
--        lock table public.subscriptions, public.ai_credit_purchases in access exclusive mode;
--        alter table public.ai_credit_purchases drop column if exists carried_from_month;
--        alter table public.subscriptions drop constraint if exists subscriptions_ai_period_pair_check;
--        alter table public.subscriptions drop column if exists ai_period_start;
--        alter table public.subscriptions drop column if exists ai_period_end;
--        commit;
--      It takes both locks together, so it can meet ai_credits_exhausted: Postgres ends one, nothing
--      has changed if it ended this one, and it can simply be run again.
--   What a rollback does to data, none of it automatically repaired:
--     - A carried pack's lowered `credits` can't be restored: the old figure isn't kept, and what was
--       spent is gone anyway.
--     - A pack left on a period key (carried or not) can be stranded: calendar keys only reach it in
--       that month, if at all.
--     - Calendar keys can land on a month with no usage row, so a subscriber can get a fresh allowance
--       on the same payment, once.

-- One transaction for the whole file (see "Transaction" above); `commit;` is the last line.
begin;

set local lock_timeout = '5s';

lock table public.subscriptions in access exclusive mode;

-- 1. The stored billing period ----------------------------------------------------------------
alter table public.subscriptions
  add column if not exists ai_period_start timestamptz,
  add column if not exists ai_period_end timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscriptions'::regclass and conname = 'subscriptions_ai_period_pair_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_ai_period_pair_check
      check ((ai_period_start is null) = (ai_period_end is null));
  end if;
end;
$$;

comment on column public.subscriptions.ai_period_start is
  'Start of the Stripe period that has been paid for: the item''s current period, except that a renewal''s waits for its invoice to be paid. The AI credit month key is computed from this and ai_period_end (ai_allowance_month()). Null = no stored period: the UTC calendar month. Written by the webhook and the re-sync script only.';
comment on column public.subscriptions.ai_period_end is
  'End of the Stripe period that has been paid for; see ai_period_start.';

-- 2. The month key ----------------------------------------------------------------------------
-- The same rule as aiAllowanceMonth() in packages/shared/src/utils/aiAllowanceMonth.ts.
-- interval + months clamps to the month's end (Oct 31 + 1 month = Nov 30), as Stripe does.
create or replace function public.ai_allowance_month(
  p_start timestamptz,
  p_end timestamptz,
  p_now timestamptz default now()
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_now timestamp := p_now at time zone 'utc';
  v_start timestamp := p_start at time zone 'utc';
  v_end timestamp := p_end at time zone 'utc';
  v_passed integer;
  v_before_end integer;
begin
  if p_now is null then
    raise exception 'ai_allowance_month: p_now is required' using errcode = '22004';
  end if;

  if p_start is null or p_end is null then
    return to_char(v_now, 'YYYY-MM');
  end if;

  if v_end - v_start <= interval '32 days' then
    return to_char(v_start, 'YYYY-MM');
  end if;

  v_passed := (extract(year from v_now)::integer - extract(year from v_start)::integer) * 12
            + (extract(month from v_now)::integer - extract(month from v_start)::integer);
  if v_start + make_interval(months => v_passed) > v_now then
    v_passed := v_passed - 1;
  end if;

  v_before_end := (extract(year from v_end)::integer - extract(year from v_start)::integer) * 12
                + (extract(month from v_end)::integer - extract(month from v_start)::integer);
  if v_start + make_interval(months => v_before_end) >= v_end then
    v_before_end := v_before_end - 1;
  end if;

  return to_char(v_start + make_interval(months => greatest(0, least(v_passed, v_before_end))), 'YYYY-MM');
end;
$$;

comment on function public.ai_allowance_month(timestamptz, timestamptz, timestamptz) is
  'The ''YYYY-MM'' key of ai_usage and ai_credit_purchases for a stored billing period at a time: the month the current allowance month started in. The same rule as aiAllowanceMonth() in packages/shared. Service role only (030).';

revoke execute on function public.ai_allowance_month(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_allowance_month(timestamptz, timestamptz, timestamptz) to service_role;

-- 3. The stored period never moves backwards ----------------------------------------------------
create or replace function public.keep_ai_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ai_period_start := old.ai_period_start;
  new.ai_period_end := old.ai_period_end;
  return new;
end;
$$;

comment on function public.keep_ai_period() is
  'Trigger: keeps the stored AI period when a write for the same subscription id would move its start backwards or clear it (030).';

revoke execute on function public.keep_ai_period() from public, anon, authenticated;

create or replace trigger subscriptions_keep_ai_period
  before update of ai_period_start, ai_period_end on public.subscriptions
  for each row
  when (
    new.id = old.id
    and old.ai_period_start is not null
    and (new.ai_period_start is null or new.ai_period_start < old.ai_period_start)
  )
  execute function public.keep_ai_period();

-- 4. Freeze trigger function: the key of the row's OLD period -----------------------------------
-- As in 027, not security definer: only the service role (webhook, re-sync script) and the owner
-- write subscriptions.ai_monthly_credits, and both may update ai_usage and run the key function.
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
     and u.month = public.ai_allowance_month(old.ai_period_start, old.ai_period_end, now());
  return null;
end;
$$;

comment on function public.freeze_ai_allowance() is
  'Trigger: when subscriptions.ai_monthly_credits drops from > 0 to 0 on an entitled managed pro_ai row, records on the ai_usage row of the key the row held before this write (ai_allowance_month() of its OLD period) how much of the usage the allowance paid for (allowance_spent), never lowering it.';

revoke execute on function public.freeze_ai_allowance() from public, anon, authenticated;

-- 5. The cap, in one place ----------------------------------------------------------------------
-- The expression is 027's, unchanged: greatest(allowance if active, allowance_spent) + unrevoked
-- packs. Not security definer: only the definer functions below and the service role call it.
create or replace function public.ai_credit_cap(p_user uuid, p_month text)
returns integer
language sql
stable
set search_path = ''
as $$
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
         ))::integer;
$$;

comment on function public.ai_credit_cap(uuid, text) is
  'The managed credit cap of (p_user, p_month): greatest(managed allowance if active, allowance_spent) + unrevoked credit packs. Used by ai_reserve_credits and ai_settle_credits. Service role only (030).';

revoke execute on function public.ai_credit_cap(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_credit_cap(uuid, text) to service_role;

-- As in 027, with the cap read from ai_credit_cap(). Signature, return shape and grants unchanged.
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

  v_cap := public.ai_credit_cap(p_user, p_month);

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
  'Service role only. Atomically adds p_amount to ai_usage.credits_used for (p_user, p_month) if it stays within ai_credit_cap() (greatest(managed allowance if active, allowance_spent) + unrevoked credit packs); returns allowed, remaining, cap.';

revoke execute on function public.ai_reserve_credits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_reserve_credits(uuid, text, integer) to service_role;

-- 6. Settle ------------------------------------------------------------------------------------
-- One UPDATE, so it is atomic against concurrent reserves and settles (row lock). The UPDATE reads
-- the row's latest version, so a concurrent reservation is counted before the cap applies.
create or replace function public.ai_settle_credits(p_user uuid, p_month text, p_delta integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cap bigint;
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

  if p_delta > 0 then
    perform 1 from public.subscriptions where user_id = p_user for share;
    v_cap := public.ai_credit_cap(p_user, p_month);
  end if;

  update public.ai_usage u
     set credits_used = case
           when p_delta > 0
             then greatest(u.credits_used::bigint, least(v_cap, u.credits_used::bigint + p_delta))::integer
           else greatest(0, u.credits_used::bigint + p_delta)::integer
         end
   where u.user_id = p_user
     and u.month = p_month
  returning u.credits_used into v_used;

  return v_used;
end;
$$;

comment on function public.ai_settle_credits(uuid, text, integer) is
  'Service role only. Adds p_delta to ai_usage.credits_used for (p_user, p_month): a negative delta never takes it below 0, a positive one never takes it past ai_credit_cap() and never lowers a value already over it. Returns the new value, or null when there is no row.';

revoke execute on function public.ai_settle_credits(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.ai_settle_credits(uuid, text, integer) to service_role;

-- 7. Packs carried when the period moves on ----------------------------------------------------
-- Not security definer, as the freeze: only the service role and the owner write the period.
-- The old key's cap is worked out from OLD, because this write may also set the allowance. This
-- trigger fires before the freeze (triggers fire by name), so if this write freezes the allowance,
-- allowance_spent isn't updated yet: the OLD branch counts the allowance instead. If an earlier write
-- froze it, OLD is past_due (0) and allowance_spent counts it.
-- Lock order: the subscriptions row is already held by this write, so no reservation, positive
-- settlement or grant is running for this user. Every unrevoked pack of the old key is locked first, in id order, and only
-- then is the headroom read: a revoke caught in between waits or has committed, and can't inflate it.
-- A settlement lowering usage during this only makes the carry smaller than it could be.
create or replace function public.carry_ai_packs_forward()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old_key text := public.ai_allowance_month(old.ai_period_start, old.ai_period_end, now());
  v_new_key text := public.ai_allowance_month(new.ai_period_start, new.ai_period_end, now());
  v_cut_short boolean := new.ai_period_start < old.ai_period_end;
  v_left bigint;
  v_moved bigint;
  v_pack record;
begin
  if v_old_key = v_new_key then
    return null;
  end if;

  perform 1
  from public.ai_credit_purchases p
  where p.user_id = new.user_id and p.month = v_old_key and p.revoked_at is null
  order by p.id
  for update;

  select greatest(
           case when old.tier = 'pro_ai' and old.ai_mode = 'managed' and old.status = 'active'
                then old.ai_monthly_credits::bigint else 0 end,
           coalesce((select a.allowance_spent::bigint from public.ai_usage a
                      where a.user_id = new.user_id and a.month = v_old_key), 0)
         )
         + coalesce((select sum(p.credits) from public.ai_credit_purchases p
                      where p.user_id = new.user_id and p.month = v_old_key and p.revoked_at is null), 0)
         - coalesce((select a.credits_used::bigint from public.ai_usage a
                      where a.user_id = new.user_id and a.month = v_old_key), 0)
    into v_left;

  for v_pack in
    select p.id, p.credits
    from public.ai_credit_purchases p
    where p.user_id = new.user_id
      and p.month = v_old_key
      and p.revoked_at is null
      and (p.created_at >= old.ai_period_end or v_cut_short)
    order by p.created_at desc, p.id desc
  loop
    exit when v_left <= 0;
    v_moved := least(v_pack.credits::bigint, v_left);
    update public.ai_credit_purchases p
       set month = v_new_key,
           credits = v_moved::integer,
           carried_from_month = coalesce(p.carried_from_month, v_old_key)
     where p.id = v_pack.id;
    v_left := v_left - v_moved;
  end loop;

  return null;
end;
$$;

comment on function public.carry_ai_packs_forward() is
  'Trigger: when the stored period moves forward to a new key, moves the unspent part of packs bought after the old period ended (or all packs, when the old period was cut short) to the new key (030).';

revoke execute on function public.carry_ai_packs_forward() from public, anon, authenticated;

-- Any subscription id: a new subscription taking over the user's row carries too.
-- subscriptions_keep_ai_period has already refused a same-id start moving back.
create or replace trigger subscriptions_carry_ai_packs
  after update of ai_period_start on public.subscriptions
  for each row
  when (
    old.ai_period_start is not null
    and old.ai_period_end is not null
    and new.ai_period_start is not null
    and new.ai_period_start > old.ai_period_start
  )
  execute function public.carry_ai_packs_forward();

-- 8. Granting a pack -----------------------------------------------------------------------------
-- As `insert ... on conflict do nothing` under the lock; the webhook used to read the key and insert
-- in two calls, and a period advance between them left the pack on the old key, after the carry.
create or replace function public.ai_grant_credit_pack(p_user uuid, p_session text, p_credits integer, p_revoked boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_user is null or p_session is null or p_revoked is null then
    raise exception 'ai_grant_credit_pack: p_user, p_session and p_revoked are required' using errcode = '22004';
  end if;
  if p_credits is null or p_credits < 0 then
    raise exception 'ai_grant_credit_pack: p_credits must be 0 or more, got %', p_credits using errcode = '22023';
  end if;

  select s.ai_period_start, s.ai_period_end into v_start, v_end
  from public.subscriptions s
  where s.user_id = p_user
  for share;

  insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id, revoked_at)
  values (
    p_user,
    public.ai_allowance_month(v_start, v_end, now()),
    p_credits,
    p_session,
    case when p_revoked then now() end
  )
  on conflict (stripe_checkout_session_id) do nothing;

  return found;
end;
$$;

comment on function public.ai_grant_credit_pack(uuid, text, integer, boolean) is
  'Service role only. Inserts a credit pack on the buyer''s current month key, read under a FOR SHARE lock on their subscriptions row (the UTC calendar month with no row or no stored period). Returns false, changing nothing, when the session already has a row (030).';

revoke execute on function public.ai_grant_credit_pack(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.ai_grant_credit_pack(uuid, text, integer, boolean) to service_role;

-- 9. End-state check -------------------------------------------------------------------------
do $$
declare
  api_role text;
  col text;
  fn regprocedure;
  def text;
begin
  foreach col in array array['ai_period_start', 'ai_period_end'] loop
    if not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.subscriptions'::regclass
        and a.attname = col and not a.attisdropped and not a.attnotnull
        and a.atttypid = 'timestamptz'::regtype
    ) then
      raise exception 'public.subscriptions.% (nullable timestamptz) is missing', col;
    end if;

    foreach api_role in array array['anon', 'authenticated'] loop
      if has_column_privilege(api_role, 'public.subscriptions', col, 'UPDATE')
         or has_column_privilege(api_role, 'public.subscriptions', col, 'INSERT') then
        raise exception 'role % can write subscriptions.%', api_role, col;
      end if;
    end loop;
  end loop;

  foreach fn in array array[
    'public.ai_allowance_month(timestamptz, timestamptz, timestamptz)'::regprocedure,
    'public.ai_credit_cap(uuid, text)'::regprocedure,
    'public.ai_reserve_credits(uuid, text, integer)'::regprocedure,
    'public.ai_settle_credits(uuid, text, integer)'::regprocedure,
    'public.ai_grant_credit_pack(uuid, text, integer, boolean)'::regprocedure
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
      select 1 from pg_catalog.pg_proc where oid = fn and proconfig @> array['search_path=""']
    ) then
      raise exception '%: must pin an empty search_path', fn;
    end if;
  end loop;

  foreach fn in array array[
    'public.freeze_ai_allowance()'::regprocedure,
    'public.keep_ai_period()'::regprocedure,
    'public.carry_ai_packs_forward()'::regprocedure
  ] loop
    foreach api_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(api_role, fn, 'EXECUTE') then
        raise exception '%: role % can execute it', fn, api_role;
      end if;
    end loop;
    if not exists (
      select 1 from pg_catalog.pg_proc where oid = fn and proconfig @> array['search_path=""']
    ) then
      raise exception '%: must pin an empty search_path', fn;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.subscriptions'::regclass
      and t.tgname = 'subscriptions_keep_ai_period' and t.tgenabled = 'O'
      and t.tgfoid = 'public.keep_ai_period()'::regprocedure
  ) then
    raise exception 'trigger subscriptions_keep_ai_period is missing or disabled';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.subscriptions'::regclass
      and t.tgname = 'subscriptions_carry_ai_packs' and t.tgenabled = 'O'
      and t.tgfoid = 'public.carry_ai_packs_forward()'::regprocedure
  ) then
    raise exception 'trigger subscriptions_carry_ai_packs is missing or disabled';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.subscriptions'::regclass
      and t.tgname = 'subscriptions_freeze_ai_allowance' and t.tgenabled = 'O'
      and t.tgfoid = 'public.freeze_ai_allowance()'::regprocedure
  ) then
    raise exception 'trigger subscriptions_freeze_ai_allowance is missing or disabled';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = 'public.ai_credit_purchases'::regclass
      and a.attname = 'carried_from_month' and not a.attisdropped and not a.attnotnull
      and a.atttypid = 'text'::regtype
  ) then
    raise exception 'public.ai_credit_purchases.carried_from_month (nullable text) is missing';
  end if;

  foreach api_role in array array['anon', 'authenticated'] loop
    if has_column_privilege(api_role, 'public.ai_credit_purchases', 'carried_from_month', 'UPDATE')
       or has_column_privilege(api_role, 'public.ai_credit_purchases', 'carried_from_month', 'INSERT') then
      raise exception 'role % can write ai_credit_purchases.carried_from_month', api_role;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_ai_period_pair_check' and contype = 'c' and convalidated
  ) then
    raise exception 'check subscriptions_ai_period_pair_check is missing';
  end if;

  -- Timing and WHEN clauses, read from each trigger's definition.
  select pg_catalog.pg_get_triggerdef(t.oid) into def
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.subscriptions'::regclass and t.tgname = 'subscriptions_keep_ai_period';
  if position('BEFORE UPDATE OF ai_period_start, ai_period_end' in def) = 0
     or position('new.id = old.id' in lower(def)) = 0 then
    raise exception 'trigger subscriptions_keep_ai_period is not BEFORE UPDATE with its same-id WHEN clause';
  end if;

  select pg_catalog.pg_get_triggerdef(t.oid) into def
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.subscriptions'::regclass and t.tgname = 'subscriptions_carry_ai_packs';
  if position('AFTER UPDATE OF ai_period_start' in def) = 0
     or position('new.ai_period_start > old.ai_period_start' in lower(def)) = 0 then
    raise exception 'trigger subscriptions_carry_ai_packs is not AFTER UPDATE with its forward-only WHEN clause';
  end if;

  select pg_catalog.pg_get_triggerdef(t.oid) into def
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.subscriptions'::regclass and t.tgname = 'subscriptions_freeze_ai_allowance';
  if position('AFTER UPDATE OF ai_monthly_credits' in def) = 0 or position('old.status' in def) = 0 then
    raise exception 'trigger subscriptions_freeze_ai_allowance has lost its timing or status filter';
  end if;

  -- Who each function runs as.
  foreach fn in array array[
    'public.ai_reserve_credits(uuid, text, integer)'::regprocedure,
    'public.ai_settle_credits(uuid, text, integer)'::regprocedure,
    'public.ai_grant_credit_pack(uuid, text, integer, boolean)'::regprocedure
  ] loop
    if not exists (select 1 from pg_catalog.pg_proc where oid = fn and prosecdef) then
      raise exception '%: must be security definer', fn;
    end if;
  end loop;
  foreach fn in array array[
    'public.ai_allowance_month(timestamptz, timestamptz, timestamptz)'::regprocedure,
    'public.ai_credit_cap(uuid, text)'::regprocedure,
    'public.freeze_ai_allowance()'::regprocedure,
    'public.keep_ai_period()'::regprocedure,
    'public.carry_ai_packs_forward()'::regprocedure
  ] loop
    if exists (select 1 from pg_catalog.pg_proc where oid = fn and prosecdef) then
      raise exception '%: must run as the caller, not as a definer', fn;
    end if;
  end loop;

  def := pg_catalog.pg_get_functiondef('public.ai_grant_credit_pack(uuid, text, integer, boolean)'::regprocedure);
  if position('for share' in def) = 0 or position('ai_allowance_month' in def) = 0 then
    raise exception 'public.ai_grant_credit_pack does not read the key under the subscriptions lock';
  end if;

  def := pg_catalog.pg_get_functiondef('public.freeze_ai_allowance()'::regprocedure);
  if position('old.ai_period_start' in def) = 0 then
    raise exception 'public.freeze_ai_allowance does not use the row''s old period';
  end if;

  def := pg_catalog.pg_get_functiondef('public.ai_reserve_credits(uuid, text, integer)'::regprocedure);
  if position('ai_credit_cap' in def) = 0 or position('for share' in def) = 0 then
    raise exception 'public.ai_reserve_credits is not the 030 version';
  end if;

  def := pg_catalog.pg_get_functiondef('public.ai_settle_credits(uuid, text, integer)'::regprocedure);
  if position('ai_credit_cap' in def) = 0 or position('for share' in def) = 0 then
    raise exception 'public.ai_settle_credits is not the 030 version';
  end if;

  -- ai_credits_exhausted (028) is only safe while the cap's rule and this check hold.
  def := pg_catalog.pg_get_functiondef('public.ai_credit_cap(uuid, text)'::regprocedure);
  if position('revoked_at is null' in def) = 0
     or position('allowance_spent' in def) = 0
     or position('s.status = ''active''' in def) = 0 then
    raise exception 'public.ai_credit_cap no longer holds the cap of 027';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ai_usage'::regclass
      and conname = 'ai_usage_allowance_spent_check' and contype = 'c'
  ) then
    raise exception 'ai_usage_allowance_spent_check (027) is missing; ai_credits_exhausted relies on it';
  end if;

  if public.ai_allowance_month('2026-10-31T00:00:00Z', '2027-10-31T00:00:00Z', '2026-12-01T00:00:00Z') <> '2026-11'
     or public.ai_allowance_month('2026-10-31T00:00:00Z', '2026-11-30T00:00:00Z', '2027-01-15T00:00:00Z') <> '2026-10'
     or public.ai_allowance_month(null, null, '2026-11-01T00:00:00Z') <> '2026-11' then
    raise exception 'public.ai_allowance_month does not compute the expected keys';
  end if;
end;
$$;

commit;
