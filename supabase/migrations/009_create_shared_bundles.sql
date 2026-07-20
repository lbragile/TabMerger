create table public.shared_bundles (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        unique not null,
  user_id       uuid        references auth.users(id) on delete cascade,
  groups_snapshot jsonb     not null,
  created_at    timestamptz default now(),
  expires_at    timestamptz
);

alter table public.shared_bundles enable row level security;

-- Anyone can read a bundle by slug (public share page, no auth required)
create policy "shared_bundles_select_public"
  on public.shared_bundles for select
  using (true);

-- Only authenticated owner can create
create policy "shared_bundles_insert_owner"
  on public.shared_bundles for insert
  to authenticated
  with check (user_id = auth.uid());

-- Only owner can delete
create policy "shared_bundles_delete_owner"
  on public.shared_bundles for delete
  using (user_id = auth.uid());

-- No UPDATE policy — snapshots are immutable

create index on public.shared_bundles (slug);
