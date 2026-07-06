create table if not exists organize_runs (
  run_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- RLS: users can only see their own runs
alter table organize_runs enable row level security;
create policy "users see own runs" on organize_runs
  for all using (auth.uid() = user_id);
