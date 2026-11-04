-- pgTAP test for 023_revoke_client_writes_billing_tables.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: subscriptions, ai_usage and ai_credit_purchases are read-only for the API
-- roles. A signed-in user (or anon) who tries to insert, update, delete or truncate is refused
-- with 42501 instead of silently matching zero rows, a signed-in user still reads their own
-- rows, and the service role can still write all three tables.
--
-- The policy layer (select-only policies) is covered by the 022 test; this one covers the
-- privilege layer. Everything runs in one transaction that is rolled back, so no test user is
-- left behind.

begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'billing-owner@example.test');

insert into public.ai_usage (user_id, month, credits_used) values
  ('00000000-0000-0000-0000-0000000000f1', '2026-10', 10);
insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id) values
  ('00000000-0000-0000-0000-0000000000f1', '2026-10', 820, 'cs_test_023_pack');

-- Privilege shape ---------------------------------------------------------------------------
select ok(
  not exists (
    select 1
    from unnest(array['public.subscriptions', 'public.ai_usage', 'public.ai_credit_purchases']) as t(tbl)
    cross join unnest(array['anon', 'authenticated']) as r(api_role)
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
    where has_table_privilege(r.api_role, t.tbl, p.priv)
       or (p.priv in ('INSERT', 'UPDATE') and has_any_column_privilege(r.api_role, t.tbl, p.priv))
  ),
  'anon and authenticated hold no write privilege on the billing tables, table or column level'
);

select ok(
  not exists (
    select 1
    from unnest(array['public.subscriptions', 'public.ai_usage', 'public.ai_credit_purchases']) as t(tbl)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
    where not has_table_privilege('service_role', t.tbl, p.priv)
  ),
  'service_role keeps select, insert, update and delete on the billing tables'
);

-- Signed-in user: every write is refused ----------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';

select throws_ok(
  $$ insert into public.subscriptions (id, user_id, tier, status)
     values ('sub_test_023', '00000000-0000-0000-0000-0000000000f1', 'pro_ai', 'active') $$,
  '42501', null, 'a signed-in user cannot insert a subscription'
);
select throws_ok(
  $$ update public.subscriptions set tier = 'pro_ai', ai_monthly_credits = 999999
     where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'a signed-in user cannot update their own subscription'
);
select throws_ok(
  $$ delete from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'a signed-in user cannot delete their own subscription'
);
select throws_ok(
  $$ truncate public.subscriptions $$,
  '42501', null, 'a signed-in user cannot truncate subscriptions'
);

select throws_ok(
  $$ insert into public.ai_usage (user_id, month, credits_used)
     values ('00000000-0000-0000-0000-0000000000f1', '2026-11', 0) $$,
  '42501', null, 'a signed-in user cannot insert ai_usage'
);
select throws_ok(
  $$ update public.ai_usage set credits_used = 0
     where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'a signed-in user cannot reset their own ai_usage'
);
select throws_ok(
  $$ delete from public.ai_usage where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'a signed-in user cannot delete their own ai_usage'
);
select throws_ok(
  $$ truncate public.ai_usage $$,
  '42501', null, 'a signed-in user cannot truncate ai_usage'
);

select throws_ok(
  $$ insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
     values ('00000000-0000-0000-0000-0000000000f1', '2026-10', 999999, 'grant_self') $$,
  '42501', null, 'a signed-in user cannot grant themselves credits'
);
select throws_ok(
  $$ update public.ai_credit_purchases set credits = 999999
     where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'a signed-in user cannot raise their own credit packs'
);
select throws_ok(
  $$ delete from public.ai_credit_purchases where user_id = '00000000-0000-0000-0000-0000000000f1' $$,
  '42501', null, 'a signed-in user cannot delete their own credit packs'
);
select throws_ok(
  $$ truncate public.ai_credit_purchases $$,
  '42501', null, 'a signed-in user cannot truncate ai_credit_purchases'
);

-- Signed-in user: reads are unchanged -------------------------------------------------------
select is(
  (select count(*)::int from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000f1'),
  1, 'a signed-in user still reads their own subscription'
);
select is(
  (select credits_used from public.ai_usage
    where user_id = '00000000-0000-0000-0000-0000000000f1' and month = '2026-10'),
  10, 'a signed-in user still reads their own ai_usage'
);
select is(
  (select sum(credits)::int from public.ai_credit_purchases
    where user_id = '00000000-0000-0000-0000-0000000000f1'),
  820, 'a signed-in user still reads their own credit packs'
);

reset role;

-- Anon: refused too -------------------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ update public.subscriptions set tier = 'pro_ai' $$,
  '42501', null, 'anon cannot update subscriptions'
);
select throws_ok(
  $$ update public.ai_usage set credits_used = 0 $$,
  '42501', null, 'anon cannot update ai_usage'
);
select throws_ok(
  $$ insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
     values ('00000000-0000-0000-0000-0000000000f1', '2026-10', 1, 'grant_anon') $$,
  '42501', null, 'anon cannot insert credit packs'
);

reset role;

-- Service role: still writes ----------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$ insert into public.ai_credit_purchases (user_id, month, credits, stripe_checkout_session_id)
     values ('00000000-0000-0000-0000-0000000000f1', '2026-10', 30, 'grant_00000000-0000-0000-0000-000000000023') $$,
  'service_role can insert a credit pack (webhook, manual grant)'
);

with x as (
  update public.subscriptions set tier = 'pro_ai', status = 'active', ai_monthly_credits = 100
   where user_id = '00000000-0000-0000-0000-0000000000f1'
  returning 1
)
select is((select count(*)::int from x), 1, 'service_role can update a subscription (webhook)');

with x as (
  update public.ai_usage set credits_used = 0
   where user_id = '00000000-0000-0000-0000-0000000000f1' and month = '2026-10'
  returning 1
)
select is((select count(*)::int from x), 1, 'service_role can update ai_usage (dev-usage route)');

with x as (
  delete from public.ai_credit_purchases
   where user_id = '00000000-0000-0000-0000-0000000000f1' and month = '2026-10'
  returning 1
)
select is((select count(*)::int from x), 2, 'service_role can delete credit packs (dev-usage reset)');

reset role;

select * from finish();
rollback;
