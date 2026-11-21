-- 032_blog_helpful_counts.sql (runs after 031_blog_post_votes.sql)
--
-- Every blog post's Helpful vote count in one public read, for the blog index. The index lists
-- every post, and a call per post would be one request per card; this returns them all at once.
--
-- What this does:
--   1. public.blog_helpful_counts(): one row (slug, helpful) per blog_posts row, ordered by slug
--      (collation "C", so the order doesn't depend on the database's locale). It takes no
--      arguments, so the result is bounded by blog_posts (which only a migration or the service
--      role adds to) and the caller controls nothing about its size. A post with no votes counts
--      0. Each count comes from 031's blog_helpful_count(slug), so the two always agree: a change
--      to how votes are counted is made there once. It returns slugs and counts only, never who
--      voted.
--      security invoker: it reads blog_posts as the caller (anon and authenticated may select
--      every row today), so any future blog_posts policy (hiding drafts, say) applies to it too.
--      Only the inner blog_helpful_count is security definer, because RLS hides other accounts'
--      votes from the caller. Empty search_path and fully qualified names all the same.
--      Executable by anon, authenticated and service_role, not PUBLIC (031's grant style).
--   2. Checks the end state and fails the migration if it is not the one described above,
--      including that every slug's count equals both blog_helpful_count(slug) and a direct count
--      of its blog_post_votes rows.
--
-- Dependency: the body is a string, so Postgres records no dependency on blog_helpful_count or
-- the tables. Dropping blog_helpful_count(text) would not be refused; it would make this
-- function fail at call time. Drop or rewrite this function first.
--
-- Re-running: the function is `create or replace` (same signature and result columns), and
-- grants and revokes are idempotent.
--
-- Rollback: a new forward migration (this file's history row stays) with the statement below,
-- or, on a database where only this file should be undone, run it and then
-- `supabase migration repair --status reverted 032`. Nothing in the database references this
-- function; the blog index shows no counts when it is missing.
--   drop function if exists public.blog_helpful_counts();

begin;

-- Only catalog writes and short reads of the two blog tables, but fail fast rather than queue.
set local lock_timeout = '5s';

-- 1. Counts for every post ----------------------------------------------------------------------
create or replace function public.blog_helpful_counts()
returns table (slug text, helpful bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.slug, public.blog_helpful_count(p.slug)
  from public.blog_posts p
  order by p.slug collate "C"
$$;

comment on function public.blog_helpful_counts() is
  'Helpful vote count of every blog post (0 for none), via blog_helpful_count(slug). Security invoker; callable by anon and authenticated (032).';

revoke execute on function public.blog_helpful_counts() from public;
grant execute on function public.blog_helpful_counts() to anon, authenticated, service_role;

-- 2. End-state check ----------------------------------------------------------------------------
do $$
declare
  api_role text;
  mismatched text;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = 'public.blog_helpful_counts()'::regprocedure
      and not prosecdef
      and provolatile = 's'
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'blog_helpful_counts: must be stable, security invoker, with an empty search_path';
  end if;

  -- No arguments in, exactly (slug text, helpful bigint) out: nothing about voters.
  if (select format('%s|%s|%s', pronargs, array_to_string(proargnames, ','),
                    array_to_string(proallargtypes::regtype[], ','))
        from pg_catalog.pg_proc
       where oid = 'public.blog_helpful_counts()'::regprocedure)
     is distinct from '0|slug,helpful|text,bigint' then
    raise exception 'blog_helpful_counts: must take no arguments and return exactly (slug text, helpful bigint)';
  end if;

  if has_function_privilege('public', 'public.blog_helpful_counts()', 'EXECUTE') then
    raise exception 'blog_helpful_counts: PUBLIC can still execute it';
  end if;

  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if not has_function_privilege(api_role, 'public.blog_helpful_counts()', 'EXECUTE') then
      raise exception 'blog_helpful_counts: role % cannot execute it', api_role;
    end if;
  end loop;

  -- One row per post, each equal to blog_helpful_count and to a direct count of its votes (a
  -- full join also catches a missing or extra slug).
  select string_agg(coalesce(p.slug, c.slug), ', ') into mismatched
    from public.blog_posts p
    full join public.blog_helpful_counts() c on c.slug = p.slug
   where p.slug is null
      or c.slug is null
      or c.helpful is distinct from public.blog_helpful_count(p.slug)
      or c.helpful is distinct from (select pg_catalog.count(*) from public.blog_post_votes v
                                      where v.post_slug = p.slug);
  if mismatched is not null then
    raise exception 'blog_helpful_counts: count disagrees with blog_helpful_count or blog_post_votes for %', mismatched;
  end if;
end;
$$;

commit;
