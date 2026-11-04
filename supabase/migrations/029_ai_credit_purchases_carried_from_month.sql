-- 029_ai_credit_purchases_carried_from_month.sql
--
-- Adds ai_credit_purchases.carried_from_month (nullable text): the month key a credit pack was first
-- carried from when a billing period moved on, with `credits` lowered to its unspent part. Null = never
-- carried, `credits` is what was granted. Migration 030's trigger subscriptions_carry_ai_packs writes it,
-- so this file runs first and the trigger never exists without the column.
--
-- Why it is its own file: a migration taking ACCESS EXCLUSIVE on subscriptions and then on
-- ai_credit_purchases in one transaction deadlocks with ai_credits_exhausted (028), which reads
-- ai_credit_purchases and then subscriptions. Each transaction here and in 030 takes one such lock.
--
-- Transaction: the file opens its own (`begin;` ... `commit;`), because the Supabase CLI sends a file's
-- statements as a batch that is not a transaction block. lock_timeout (5s) makes a blocked migration
-- fail without changing anything rather than queue reads behind it. A nullable column with no default
-- rewrites nothing, so the lock is held for milliseconds.
--
-- Re-running: `if not exists`.
--
-- Rollback: step 4 of the rollback in 030's header. Nothing but 030 uses this column, and 030 tolerates
-- no rollback of this file alone: roll 030 back first.

-- One transaction for the whole file (see "Transaction" above); `commit;` is the last line.
begin;

set local lock_timeout = '5s';

lock table public.ai_credit_purchases in access exclusive mode;

alter table public.ai_credit_purchases
  add column if not exists carried_from_month text;

comment on column public.ai_credit_purchases.carried_from_month is
  'The month key this pack was first carried from when a period moved on, with `credits` lowered to its unspent part (subscriptions_carry_ai_packs, 030). Null = never carried, `credits` is what was granted.';

-- End-state check ----------------------------------------------------------------------------------
do $$
declare
  api_role text;
begin
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
end;
$$;

commit;
