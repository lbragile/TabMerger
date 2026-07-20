alter table public.groups add column if not exists public_slug text unique;
alter table public.groups add column if not exists view_count integer not null default 0;

-- Atomic view count increment called from the share page (service role, best-effort)
create or replace function public.increment_group_view_count(slug_param text)
returns void language sql security definer as $$
  update public.groups set view_count = view_count + 1 where public_slug = slug_param;
$$;
