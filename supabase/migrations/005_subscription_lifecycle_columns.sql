-- PAY-001: Stripe subscription lifecycle columns
alter table public.subscriptions add column if not exists cancel_at_period_end boolean default false;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists stripe_price_id text;
