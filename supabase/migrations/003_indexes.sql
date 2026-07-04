-- Performance indexes
create index if not exists groups_user_id_idx on public.groups(user_id);
create index if not exists groups_updated_at_idx on public.groups(updated_at desc);
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists subscriptions_user_id_idx on public.subscriptions(user_id);
create index if not exists subscriptions_status_idx on public.subscriptions(status);
