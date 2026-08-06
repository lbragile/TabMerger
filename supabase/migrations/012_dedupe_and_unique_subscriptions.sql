-- Fix: subscriptions had no UNIQUE constraint on user_id, allowing duplicate rows
-- (e.g. the free-tier default row from handle_new_user() plus a later real
-- Stripe-webhook row). Postgrest .maybeSingle() throws on >1 row, which
-- useEntitlements swallows as an error and silently falls back to 'free'.
--
-- Step 1: for any user_id with multiple rows, keep only the most recently
-- updated row (highest updated_at, tie-broken by created_at) and delete the
-- rest. This favors real subscription state (set by the Stripe webhook) over
-- the default free row from signup, since the webhook write is always more
-- recent than the signup-time default.
delete from public.subscriptions s
where s.id in (
  select id from (
    select id,
           row_number() over (
             partition by user_id
             order by updated_at desc nulls last, created_at desc nulls last
           ) as rn
    from public.subscriptions
  ) ranked
  where rn > 1
);

-- Step 2: enforce one subscription row per user going forward. Named
-- constraint so it can be targeted directly by a Supabase upsert's
-- onConflict: 'user_id'.
alter table public.subscriptions
  add constraint subscriptions_user_id_key unique (user_id);

-- The unique constraint above creates its own unique index on user_id,
-- making the plain non-unique index from 003_indexes.sql redundant.
drop index if exists public.subscriptions_user_id_idx;
