-- One-time purchased AI credit packs, topping up a user's monthly ai_usage allowance.
-- Credits are month-scoped (no rollover) to match ai_usage's month-keyed design.
-- Separate table (not a column on ai_usage) so each Stripe checkout session can be
-- recorded for idempotent webhook processing -- Stripe may redeliver the same event
-- and we must not double-credit the user.
create table public.ai_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  month text not null, -- 'YYYY-MM', matches ai_usage.month -- credits expire at month end
  credits integer not null,
  stripe_checkout_session_id text unique not null, -- enforces idempotency on webhook redelivery
  created_at timestamptz default now() not null
);

create index ai_credit_purchases_user_month_idx on public.ai_credit_purchases(user_id, month);

alter table public.ai_credit_purchases enable row level security;

-- Read-only for clients; only the service-role client (Stripe webhook) writes rows.
create policy "Users can read own credit purchases" on public.ai_credit_purchases
  for select using (auth.uid() = user_id);
