-- "Continue on other device" feature: each device the user has synced from
-- registers a row here with a snapshot of its "Now Open" tabs, so other
-- devices of the SAME user can see/pull it. No cross-user sharing.

create table public.device_sessions (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  device_id         text        not null,
  device_name       text        not null,
  now_open_snapshot jsonb       not null default '[]'::jsonb,
  last_active       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (user_id, device_id)
);

alter table public.device_sessions enable row level security;

create policy "device_sessions_select_owner"
  on public.device_sessions for select
  using (auth.uid() = user_id);

create policy "device_sessions_insert_owner"
  on public.device_sessions for insert
  with check (auth.uid() = user_id);

create policy "device_sessions_update_owner"
  on public.device_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "device_sessions_delete_owner"
  on public.device_sessions for delete
  using (auth.uid() = user_id);

create index device_sessions_user_id_last_active_idx
  on public.device_sessions (user_id, last_active);
