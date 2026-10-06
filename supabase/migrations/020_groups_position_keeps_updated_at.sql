-- 020_groups_position_keeps_updated_at.sql
--
-- Why: groups sync last-write-wins on updated_at. The extension now pushes reorders as a
-- position-only update (`update({ position }).eq('id', id)`). With the shared
-- update_updated_at() trigger every such update stamped updated_at = now(), so a reorder
-- that changed no content would beat another device's newer content edits. A position-only
-- update must therefore keep the existing updated_at.
--
-- view_count is excluded from the content comparison too: increment_group_view_count() (007)
-- bumps it on every public share view, which is not a content edit. Stamping updated_at there
-- would let a stranger's page view beat a device's newer edits (same last-write-wins bug class).
--
-- Fast path: when neither position nor view_count changed, something else did, so stamp now()
-- without building jsonb. The jsonb comparison stays authoritative for the rest, so a future
-- content column is treated as content by default. (An identical no-op update takes the fast
-- path and is stamped, exactly like the old trigger.)
--
-- Scope: new function used by `groups` only. update_updated_at() is left untouched and is
-- still used by subscriptions_updated_at (001 is the only other user; no later migration
-- references it).
--
-- updated_at policy for content updates is unchanged: the server always stamps now() and
-- ignores any client-supplied updated_at. Respecting a client value would let a client
-- (or a device with a skewed clock) forge recency and win last-write-wins; the server clock
-- is the single authority.
--
-- Hygiene: invoker rights (a trigger needs no elevated privileges) and `set search_path = ''`
-- like 019's helper; only pg_catalog objects (to_jsonb, jsonb `-`, now) are used.
--
-- RLS: unchanged. A position-only update goes through the existing "groups_update_own"
-- policy (019): using auth.uid() = user_id with check (auth.uid() = user_id and
-- has_cloud_sync()). Nothing here touches policies.
--
-- Rollback (restores 001 behaviour):
--   drop trigger if exists groups_updated_at on public.groups;
--   create trigger groups_updated_at before update on public.groups
--     for each row execute procedure public.update_updated_at();
--   drop function if exists public.groups_set_updated_at();

create or replace function public.groups_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Fast path: position and view_count untouched, so any change is content.
  if new.position is not distinct from old.position
     and new.view_count is not distinct from old.view_count then
    new.updated_at := now();
    return new;
  end if;

  -- Only position / view_count / the timestamp differ: not a content change, keep the stamp.
  if (to_jsonb(new) - 'position' - 'updated_at' - 'view_count')
     = (to_jsonb(old) - 'position' - 'updated_at' - 'view_count') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists groups_updated_at on public.groups;
create trigger groups_updated_at before update on public.groups
  for each row execute function public.groups_set_updated_at();
