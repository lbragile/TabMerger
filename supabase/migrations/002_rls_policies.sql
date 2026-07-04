-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.groups enable row level security;
alter table public.sessions enable row level security;

-- Profiles: users can only see/edit their own
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Subscriptions: users can only see their own
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Groups: full CRUD for own rows only
create policy "groups_select_own" on public.groups
  for select using (auth.uid() = user_id);

create policy "groups_insert_own" on public.groups
  for insert with check (auth.uid() = user_id);

create policy "groups_update_own" on public.groups
  for update using (auth.uid() = user_id);

create policy "groups_delete_own" on public.groups
  for delete using (auth.uid() = user_id);

-- Sessions: full CRUD for own rows only
create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() = user_id);

create policy "sessions_insert_own" on public.sessions
  for insert with check (auth.uid() = user_id);

create policy "sessions_update_own" on public.sessions
  for update using (auth.uid() = user_id);

create policy "sessions_delete_own" on public.sessions
  for delete using (auth.uid() = user_id);
