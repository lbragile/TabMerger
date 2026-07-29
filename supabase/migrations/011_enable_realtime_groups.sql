-- Enables Supabase Realtime (postgres_changes) on public.groups so the
-- dashboard SyncIndicator can subscribe to live INSERT/UPDATE/DELETE
-- events instead of only showing the last-known sync time from initial
-- fetch. RLS on public.groups (see 002_rls_policies.sql) already scopes
-- every policy to auth.uid() = user_id, and Realtime enforces RLS on
-- postgres_changes subscriptions, so this does not leak other users'
-- rows/events.

alter publication supabase_realtime add table public.groups;

-- rollback: alter publication supabase_realtime drop table public.groups;
