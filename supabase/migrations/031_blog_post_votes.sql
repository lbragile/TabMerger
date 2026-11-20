-- 031_blog_post_votes.sql (runs after 030_ai_billing_period_credits.sql)
--
-- "Helpful" votes on blog posts. Anyone can see a post's count; only a signed-in account can
-- vote, and only once per post. That rule must hold for a client that calls Supabase directly
-- with the public anon key (CLAUDE.md, "Trust model"), so the database enforces it: the browser
-- client writes to blog_post_votes itself and there is no API route. Voting is not a paid
-- feature; free accounts vote too.
--
-- What this does:
--   1. public.blog_posts: one row per post that accepts votes, keyed by its URL slug (English in
--      every locale, so all locales share one count): lowercase letters and digits in words
--      joined by single hyphens, at most 80 characters. Seeded with 'save-all-open-tabs'. A new
--      post adds its row in its own migration. Readable by everyone; the API roles hold SELECT
--      only, so nothing but a migration or the service role adds or changes a post.
--   2. public.blog_post_votes: one row per (post, account). The foreign key to blog_posts refuses
--      a vote on a made-up slug and carries votes along when a slug is renamed; the primary key
--      refuses a second vote. user_id defaults to auth.uid(). Policies, all for `authenticated`
--      only: read, add and remove your own vote. Adding also refuses an anonymous Supabase
--      session (`is_anonymous` in the JWT; anonymous sign-ins are off today, this keeps "an
--      account" meaning a real account if they are ever turned on). There is no update policy
--      and no UPDATE privilege: a vote is added or removed, never edited. anon holds no
--      privilege on the table at all. Indexed on user_id for the cascade when an account is
--      deleted. The foreign key to auth.users takes SHARE ROW EXCLUSIVE on auth.users until
--      commit, so the file runs with lock_timeout 5s: if something slow holds auth.users, the
--      migration fails fast instead of stalling every sign-in and sign-up write behind it.
--   3. public.blog_helpful_count(p_slug): the number of votes on a post (0 for an unknown slug).
--      security definer with an empty search_path, because RLS hides other accounts' votes from
--      the caller; it returns a count only, never who voted. Executable by anon, authenticated
--      and service_role, not PUBLIC.
--   4. Checks the end state and fails the migration if it is not the one described above.
--
-- Re-running: tables and index use `if not exists`, the seed `on conflict do nothing`, policies
-- are dropped and re-created, the function is `create or replace`, and grants and revokes are
-- idempotent.
--
-- Rollback: a new forward migration (this file's history row stays) with the statements below,
-- or, on a database where only this file should be undone, run them and then
-- `supabase migration repair --status reverted 031`. Nothing else references these objects;
-- the web app's Helpful button shows no count and reports an error on a vote when they are
-- missing.
--   begin;
--   set local lock_timeout = '5s';
--   drop function if exists public.blog_helpful_count(text);
--   drop table if exists public.blog_post_votes;
--   drop table if exists public.blog_posts;
--   commit;

begin;

-- The foreign key to auth.users below locks auth.users (SHARE ROW EXCLUSIVE) until commit. Fail
-- fast instead of queueing every sign-up and sign-in write behind it, as 022 and 024 do.
set local lock_timeout = '5s';

-- 1. Posts ------------------------------------------------------------------------------------
create table if not exists public.blog_posts (
  slug text not null,
  created_at timestamptz not null default now(),
  constraint blog_posts_pkey primary key (slug),
  constraint blog_posts_slug_check
    check (char_length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

comment on table public.blog_posts is
  'Blog posts that accept Helpful votes, keyed by URL slug. Added by migrations only (031).';

insert into public.blog_posts (slug) values ('save-all-open-tabs')
on conflict (slug) do nothing;

alter table public.blog_posts enable row level security;

drop policy if exists "blog_posts_select_all" on public.blog_posts;
create policy "blog_posts_select_all" on public.blog_posts
  for select to anon, authenticated
  using (true);

revoke all on table public.blog_posts from public, anon, authenticated;
grant select on table public.blog_posts to anon, authenticated;

-- 2. Votes ------------------------------------------------------------------------------------
create table if not exists public.blog_post_votes (
  post_slug text not null,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint blog_post_votes_pkey primary key (post_slug, user_id),
  constraint blog_post_votes_post_slug_fkey foreign key (post_slug)
    references public.blog_posts (slug) on update cascade on delete cascade,
  constraint blog_post_votes_user_id_fkey foreign key (user_id)
    references auth.users (id) on delete cascade
);

comment on table public.blog_post_votes is
  'One Helpful vote per (blog post, account). Owners add and remove their own; counts via blog_helpful_count() (031).';

create index if not exists blog_post_votes_user_id_idx
  on public.blog_post_votes (user_id);

alter table public.blog_post_votes enable row level security;

drop policy if exists "blog_post_votes_select_own" on public.blog_post_votes;
create policy "blog_post_votes_select_own" on public.blog_post_votes
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "blog_post_votes_insert_own" on public.blog_post_votes;
create policy "blog_post_votes_insert_own" on public.blog_post_votes
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and ((select auth.jwt()) ->> 'is_anonymous')::boolean is not true
  );

drop policy if exists "blog_post_votes_delete_own" on public.blog_post_votes;
create policy "blog_post_votes_delete_own" on public.blog_post_votes
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- No update policy: a vote is added or removed, never edited.

revoke all on table public.blog_post_votes from public, anon, authenticated;
grant select, insert, delete on table public.blog_post_votes to authenticated;

-- 3. Count ------------------------------------------------------------------------------------
create or replace function public.blog_helpful_count(p_slug text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*) from public.blog_post_votes where post_slug = p_slug
$$;

comment on function public.blog_helpful_count(text) is
  'Number of Helpful votes on a blog post (0 for an unknown slug). Callable by anon and authenticated (031).';

revoke execute on function public.blog_helpful_count(text) from public;
grant execute on function public.blog_helpful_count(text) to anon, authenticated, service_role;

-- 4. End-state check --------------------------------------------------------------------------
do $$
declare
  api_role text;
  priv text;
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.blog_posts'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.blog_post_votes'::regclass and relrowsecurity
  ) then
    raise exception 'blog_posts / blog_post_votes: row level security is not enabled';
  end if;

  -- Name, command and roles of every policy: policies are permissive (OR-ed), so an extra one,
  -- or one widened to another command or role, would reopen what the others close.
  if (select array_agg(format('%s:%s:%s', policyname, cmd, array_to_string(roles, ','))
                       order by policyname)
        from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'blog_posts')
     is distinct from array['blog_posts_select_all:SELECT:anon,authenticated'] then
    raise exception 'blog_posts: policies are not exactly blog_posts_select_all for SELECT to anon, authenticated';
  end if;

  if (select array_agg(format('%s:%s:%s', policyname, cmd, array_to_string(roles, ','))
                       order by policyname)
        from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'blog_post_votes')
     is distinct from array[
       'blog_post_votes_delete_own:DELETE:authenticated',
       'blog_post_votes_insert_own:INSERT:authenticated',
       'blog_post_votes_select_own:SELECT:authenticated'
     ] then
    raise exception 'blog_post_votes: policies are not exactly select/insert/delete own to authenticated';
  end if;

  foreach api_role in array array['anon', 'authenticated'] loop
    if not has_table_privilege(api_role, 'public.blog_posts', 'SELECT') then
      raise exception 'blog_posts: role % cannot select', api_role;
    end if;
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(api_role, 'public.blog_posts', priv) then
        raise exception 'blog_posts: role % still holds %', api_role, priv;
      end if;
    end loop;
    foreach priv in array array['UPDATE', 'TRUNCATE'] loop
      if has_table_privilege(api_role, 'public.blog_post_votes', priv) then
        raise exception 'blog_post_votes: role % still holds %', api_role, priv;
      end if;
    end loop;
    if not has_function_privilege(api_role, 'public.blog_helpful_count(text)', 'EXECUTE') then
      raise exception 'blog_helpful_count: role % cannot execute it', api_role;
    end if;
  end loop;

  foreach priv in array array['SELECT', 'INSERT', 'DELETE'] loop
    if has_table_privilege('anon', 'public.blog_post_votes', priv) then
      raise exception 'blog_post_votes: anon still holds %', priv;
    end if;
    if not has_table_privilege('authenticated', 'public.blog_post_votes', priv) then
      raise exception 'blog_post_votes: authenticated is missing %', priv;
    end if;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_proc
    where oid = 'public.blog_helpful_count(text)'::regprocedure
      and prosecdef
      and proconfig @> array['search_path=""']
  ) then
    raise exception 'blog_helpful_count: must be security definer with an empty search_path';
  end if;

  if not exists (select 1 from public.blog_posts where slug = 'save-all-open-tabs') then
    raise exception 'blog_posts: the save-all-open-tabs row is missing';
  end if;
end;
$$;

commit;
