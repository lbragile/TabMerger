-- 035_blog_posts_deploy_sync.sql (runs after 032_blog_helpful_counts.sql)
--
-- Keeps public.blog_posts (031, the list of posts that accept Helpful votes) in step with the
-- posts the web app actually ships, without a migration per post. Each web deploy job calls
-- sync_blog_posts() with every slug in that build. The job calls it through PostgREST with the
-- public anon key, like any client, so the anon key is not what protects it: a single-purpose
-- sync token is. The database stores only the token's SHA-256, in a schema the API does not
-- expose, so neither the token nor its hash is in the repo or readable through the API.
--
-- What this does:
--   1. public.blog_posts gets `missing_since timestamptz null`: when a deploy last stopped
--      listing the post (null = listed by the most recent sync). A post that stays unlisted for
--      30 days is deleted, and 031's foreign key (`on delete cascade`, unchanged) deletes its
--      votes with it. The grace period keeps a bad deploy (a partial slug list, a rollback, a
--      branch preview built without newer posts) from deleting votes: the next good deploy
--      clears missing_since. 031's slug check, RLS and grants on blog_posts and blog_post_votes
--      are unchanged.
--   2. private.blog_sync_settings: one row (id = true) holding token_sha256 (bytea, 32 bytes, or
--      null). Schema `private` is not in the API's exposed schemas (config.toml [api] schemas,
--      and hosted defaults), and anon, authenticated and service_role get no USAGE on it and no
--      privilege on the table either, so it stays unreadable even if the schema were ever
--      exposed. RLS is on with no policy as a further layer. The migration stores no hash: each
--      project's owner sets it once (see docs/database-schema.md); supabase/seed.sql sets a
--      dev-only one for the local stack. No row, or a null hash, means every call is refused.
--      A plain table rather than Supabase Vault: the value is a hash, not a secret the database
--      must later read back in clear, so Vault's encryption buys nothing and would add a
--      dependency on the supabase_vault extension and its decrypted view.
--   3. public.sync_blog_posts(p_slugs text[], p_token text) returns jsonb
--      {"added": n, "missing": n, "deleted": n}. security definer (it writes blog_posts, which
--      the API roles may only read, and reads the private table), empty search_path, volatile,
--      plpgsql. In order:
--        a. token: refused unless a hash is stored and pg_catalog.sha256() of p_token (UTF-8)
--           equals it. A null token, or one longer than 256 bytes, is refused the same way.
--           Every refusal is the same `not authorized` (42501), saying nothing about why. This
--           runs first, so a caller without the token learns nothing about the input rules and
--           never reaches the lock below. The built-in pg_catalog.sha256() (Postgres 11+) is
--           used rather than pgcrypto's digest(): same bytes, nothing to resolve through the
--           extensions schema, and no dependency on where pgcrypto is installed.
--        b. input: refused as a whole (22023) if p_slugs is null, empty, not one-dimensional,
--           has more than 1000 entries, or any entry is null, longer than 80 characters or not
--           words of [a-z0-9] joined by single hyphens (031's slug check). Duplicates are fine.
--        c. a transaction-scoped advisory lock, so two deploys syncing at once run one after
--           the other and the counts each returns are its own.
--        d. inserts new slugs (`on conflict do nothing`), clears missing_since on every listed
--           slug, sets missing_since = now() on unlisted rows that don't have one yet, then
--           deletes rows with missing_since older than 30 days (their votes go by cascade).
--           Listed rows are cleared before the delete, so a listed post is never deleted.
--      Returns added = rows inserted, missing = rows still marked missing after the call (not
--      only the ones this call marked, so a repeat call reports the same number), deleted = rows
--      deleted. It all runs in the caller's one transaction: any error leaves nothing changed.
--      EXECUTE revoked from PUBLIC, granted to anon, authenticated and service_role: the token is
--      the gate, and the deploy job only holds the anon key. Call it with POST (PostgREST runs
--      GET in a read-only transaction).
--   4. public.blog_helpful_counts() (032) now lists only posts with missing_since null, so a
--      post that left the site drops off the index's counts at once rather than after 30 days.
--      Same signature, result columns, security invoker, stable, empty search_path; `create or
--      replace` keeps its grants. blog_helpful_count(slug) (031) is unchanged and still counts
--      any slug, missing or not.
--   5. blog_posts' table comment now says posts come from the deploy sync.
--   6. Checks the end state and fails the migration if it is not the one described above.
--
-- Locks: adding a nullable column with no default only touches the catalog, but takes ACCESS
-- EXCLUSIVE on blog_posts until commit, which briefly holds up a vote's foreign key check and the
-- counts. lock_timeout 5s makes the migration fail fast instead of queueing those behind it.
--
-- Dependency: function bodies are strings, so Postgres records no dependency of
-- sync_blog_posts or blog_helpful_counts on missing_since or the settings table. Dropping either
-- would not be refused; the functions would fail at call time. Drop or rewrite them first.
--
-- Re-running: `if not exists` on the schema, table and column, `create or replace` on the
-- functions, idempotent grants, revokes and comments.
--
-- Rollback: a new forward migration (this file's history row stays) with the statements below,
-- or, on a database where only this file should be undone, run them and then
-- `supabase migration repair --status reverted 035`. Posts marked missing become ordinary
-- listed posts again. Posts the sync already deleted, and their votes, are gone; the rollback
-- does not bring them back. After a rollback a new post again needs its own blog_posts row.
--   begin;
--   set local lock_timeout = '5s';
--   drop function if exists public.sync_blog_posts(text[], text);
--   create or replace function public.blog_helpful_counts()
--   returns table (slug text, helpful bigint)
--   language sql stable security invoker set search_path = ''
--   as $f$
--     select p.slug, public.blog_helpful_count(p.slug)
--     from public.blog_posts p
--     order by p.slug collate "C"
--   $f$;
--   alter table public.blog_posts drop column if exists missing_since;
--   drop table if exists private.blog_sync_settings;
--   drop schema if exists private;   -- refused (and the file rolled back) if anything else is in it
--   commit;

begin;

-- Adding the column locks blog_posts (ACCESS EXCLUSIVE) until commit; fail fast rather than queue.
set local lock_timeout = '5s';

-- 1. missing_since ------------------------------------------------------------------------------
alter table public.blog_posts add column if not exists missing_since timestamptz null;

comment on column public.blog_posts.missing_since is
  'When a deploy sync last stopped listing this post; null = listed. Deleted (votes cascade) after 30 days (035).';

comment on table public.blog_posts is
  'Blog posts that accept Helpful votes, keyed by URL slug. Kept in step with the deployed posts by sync_blog_posts() (031, 035).';

-- 2. Private settings ---------------------------------------------------------------------------
create schema if not exists private;

comment on schema private is
  'Server-only objects. Not exposed through the API; no USAGE for anon, authenticated or service_role (035).';

revoke all on schema private from public, anon, authenticated, service_role;

create table if not exists private.blog_sync_settings (
  id boolean not null default true,
  token_sha256 bytea null,
  updated_at timestamptz not null default now(),
  constraint blog_sync_settings_pkey primary key (id),
  constraint blog_sync_settings_single_row check (id),
  constraint blog_sync_settings_token_sha256_check
    check (token_sha256 is null or pg_catalog.octet_length(token_sha256) = 32)
);

comment on table private.blog_sync_settings is
  'One row: SHA-256 of the blog deploy-sync token, read only by sync_blog_posts(). Set by hand per project; null or no row refuses every sync (035).';

alter table private.blog_sync_settings enable row level security;

revoke all on table private.blog_sync_settings from public, anon, authenticated, service_role;

-- 3. Sync ---------------------------------------------------------------------------------------
create or replace function public.sync_blog_posts(p_slugs text[], p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_slugs text[];
  v_added integer;
  v_missing integer;
  v_deleted integer;
begin
  -- a. Token. One generic refusal for every reason.
  select s.token_sha256 into v_hash
    from private.blog_sync_settings s
   where s.id;

  if v_hash is null
     or p_token is null
     or pg_catalog.octet_length(p_token) > 256
     or pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')) is distinct from v_hash then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- b. Input, all or nothing.
  if p_slugs is null or pg_catalog.cardinality(p_slugs) = 0 then
    raise exception 'p_slugs must list at least one slug' using errcode = '22023';
  end if;
  if pg_catalog.array_ndims(p_slugs) <> 1 then
    raise exception 'p_slugs must be a one-dimensional array' using errcode = '22023';
  end if;
  if pg_catalog.cardinality(p_slugs) > 1000 then
    raise exception 'p_slugs must list at most 1000 slugs' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(p_slugs) as u(slug)
     where u.slug is null
        or pg_catalog.char_length(u.slug) > 80
        or u.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ) then
    raise exception 'every slug must be words of [a-z0-9] joined by single hyphens, at most 80 characters'
      using errcode = '22023';
  end if;

  select pg_catalog.array_agg(distinct u.slug) into v_slugs
    from pg_catalog.unnest(p_slugs) as u(slug);

  -- c. One sync at a time.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.sync_blog_posts', 0)
  );

  -- d. Effects.
  with inserted as (
    insert into public.blog_posts (slug)
    select u.slug from pg_catalog.unnest(v_slugs) as u(slug)
    on conflict (slug) do nothing
    returning 1
  )
  select pg_catalog.count(*)::integer into v_added from inserted;

  update public.blog_posts p
     set missing_since = null
   where p.slug = any (v_slugs)
     and p.missing_since is not null;

  update public.blog_posts p
     set missing_since = pg_catalog.now()
   where p.missing_since is null
     and not (p.slug = any (v_slugs));

  with deleted as (
    delete from public.blog_posts p
     where p.missing_since < pg_catalog.now() - interval '30 days'
    returning 1
  )
  select pg_catalog.count(*)::integer into v_deleted from deleted;

  select pg_catalog.count(*)::integer into v_missing
    from public.blog_posts p
   where p.missing_since is not null;

  return pg_catalog.jsonb_build_object(
    'added', v_added,
    'missing', v_missing,
    'deleted', v_deleted
  );
end;
$$;

comment on function public.sync_blog_posts(text[], text) is
  'Deploy sync of blog_posts: adds listed slugs, marks unlisted ones missing, deletes those missing over 30 days. Gated by a token whose SHA-256 is in private.blog_sync_settings (035).';

revoke execute on function public.sync_blog_posts(text[], text) from public;
grant execute on function public.sync_blog_posts(text[], text) to anon, authenticated, service_role;

-- 4. Counts hide missing posts ------------------------------------------------------------------
create or replace function public.blog_helpful_counts()
returns table (slug text, helpful bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.slug, public.blog_helpful_count(p.slug)
  from public.blog_posts p
  where p.missing_since is null
  order by p.slug collate "C"
$$;

comment on function public.blog_helpful_counts() is
  'Helpful vote count of every listed blog post (missing_since null; 0 for none), via blog_helpful_count(slug). Security invoker; callable by anon and authenticated (032, 035).';

revoke execute on function public.blog_helpful_counts() from public;
grant execute on function public.blog_helpful_counts() to anon, authenticated, service_role;

-- 6. End-state check ----------------------------------------------------------------------------
do $$
declare
  api_role text;
  priv text;
  mismatched text;
begin
  -- missing_since: nullable timestamptz.
  if not exists (
    select 1 from pg_catalog.pg_attribute
     where attrelid = 'public.blog_posts'::regclass
       and attname = 'missing_since'
       and not attisdropped
       and atttypid = 'timestamptz'::regtype
       and not attnotnull
  ) then
    raise exception 'blog_posts: missing_since must be a nullable timestamptz';
  end if;

  -- 031's blog_posts policy and privileges, unchanged.
  if (select array_agg(format('%s:%s:%s', policyname, cmd, array_to_string(roles, ','))
                       order by policyname)
        from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'blog_posts')
     is distinct from array['blog_posts_select_all:SELECT:anon,authenticated'] then
    raise exception 'blog_posts: policies are not exactly blog_posts_select_all for SELECT to anon, authenticated';
  end if;

  foreach api_role in array array['anon', 'authenticated'] loop
    if not has_table_privilege(api_role, 'public.blog_posts', 'SELECT') then
      raise exception 'blog_posts: role % cannot select', api_role;
    end if;
    foreach priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(api_role, 'public.blog_posts', priv) then
        raise exception 'blog_posts: role % holds %', api_role, priv;
      end if;
    end loop;
  end loop;

  -- private: no API role can reach the schema or the table.
  if exists (
    select 1 from pg_catalog.pg_class
     where oid = 'private.blog_sync_settings'::regclass and not relrowsecurity
  ) then
    raise exception 'private.blog_sync_settings: row level security is not enabled';
  end if;

  if exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'private' and tablename = 'blog_sync_settings'
  ) then
    raise exception 'private.blog_sync_settings: must have no policies';
  end if;

  foreach api_role in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(api_role, 'private', 'USAGE')
       or has_schema_privilege(api_role, 'private', 'CREATE') then
      raise exception 'schema private: role % holds USAGE or CREATE', api_role;
    end if;
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(api_role, 'private.blog_sync_settings', priv) then
        raise exception 'private.blog_sync_settings: role % holds %', api_role, priv;
      end if;
    end loop;
  end loop;

  -- sync_blog_posts: definer, volatile, empty search_path, exact signature and result.
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'public.sync_blog_posts(text[], text)'::regprocedure
       and prosecdef
       and provolatile = 'v'
       and proconfig @> array['search_path=""']
       and prorettype = 'jsonb'::regtype
       and array_to_string(proargnames, ',') = 'p_slugs,p_token'
  ) then
    raise exception 'sync_blog_posts: must be volatile security definer (p_slugs text[], p_token text) returns jsonb with an empty search_path';
  end if;

  if has_function_privilege('public', 'public.sync_blog_posts(text[], text)', 'EXECUTE') then
    raise exception 'sync_blog_posts: PUBLIC can still execute it';
  end if;

  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if not has_function_privilege(api_role, 'public.sync_blog_posts(text[], text)', 'EXECUTE') then
      raise exception 'sync_blog_posts: role % cannot execute it', api_role;
    end if;
  end loop;

  -- blog_helpful_counts: 032's shape and grants, kept.
  if not exists (
    select 1 from pg_catalog.pg_proc
     where oid = 'public.blog_helpful_counts()'::regprocedure
       and not prosecdef
       and provolatile = 's'
       and proconfig @> array['search_path=""']
  ) then
    raise exception 'blog_helpful_counts: must be stable, security invoker, with an empty search_path';
  end if;

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

  -- One row per listed post (none for a missing one), each equal to blog_helpful_count and to a
  -- direct count of its votes.
  select string_agg(coalesce(p.slug, c.slug), ', ') into mismatched
    from (select b.slug from public.blog_posts b where b.missing_since is null) p
    full join public.blog_helpful_counts() c on c.slug = p.slug
   where p.slug is null
      or c.slug is null
      or c.helpful is distinct from public.blog_helpful_count(p.slug)
      or c.helpful is distinct from (select pg_catalog.count(*) from public.blog_post_votes v
                                      where v.post_slug = p.slug);
  if mismatched is not null then
    raise exception 'blog_helpful_counts: rows disagree with the listed blog_posts or their votes for %', mismatched;
  end if;
end;
$$;

commit;
