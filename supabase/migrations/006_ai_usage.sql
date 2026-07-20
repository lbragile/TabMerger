-- AI usage tracking: 100 requests/month per pro_ai user
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  month text not null, -- 'YYYY-MM'
  request_count integer default 0 not null,
  unique(user_id, month)
);

alter table public.ai_usage enable row level security;

create policy "Users can read own usage" on public.ai_usage
  for select using (auth.uid() = user_id);
