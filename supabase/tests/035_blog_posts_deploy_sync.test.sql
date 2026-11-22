-- pgTAP test for 035_blog_posts_deploy_sync.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: only a caller holding the deploy-sync token can change blog_posts through
-- sync_blog_posts(), even though anon may call it; a bad call changes nothing; and the sync adds,
-- marks, clears and (after 30 days) deletes posts as described, taking deleted posts' votes along.
--
--   shape          -> security definer, volatile, empty search_path; executable by anon,
--                     authenticated and service_role, not PUBLIC; a role without the grant is
--                     refused at call time (42501)
--   settings table -> anon and authenticated hold no USAGE on schema private and no privilege on
--                     the table (a read is 42501); RLS on, no policies
--   token          -> no row, a null hash, a wrong, null or over-long token: all refused with the
--                     same 'not authorized' (42501), and blog_posts is unchanged
--   input          -> null, empty, two-dimensional or 1001-entry lists, and a null, 81-character
--                     or malformed slug: the whole call is refused (22023), even the valid slugs
--                     in it are not added; exactly 1000 slugs is accepted
--   effects        -> a new slug is added once (duplicates collapse); a re-listed slug's
--                     missing_since is cleared; an unlisted one is marked now(), an already
--                     marked one keeps its date; missing 31 days -> deleted with its votes,
--                     missing 29 days -> kept; the result counts {added, missing, deleted}
--   re-run         -> the same list again changes nothing and reports added 0, deleted 0
--   counts         -> blog_helpful_counts() lists only posts with missing_since null;
--                     blog_helpful_count(slug) still counts a missing post's votes
--
-- Strategy: as the test runner (the tables' owner), start from an empty blog_posts and a known
-- settings row (seed.sql stores a dev hash locally; this test replaces it), set up posts with
-- backdated missing_since, then call the function as anon (what the deploy job uses) and as
-- authenticated. now() is fixed for the transaction, so "marked now()" is exact. Everything runs
-- in one transaction that is rolled back.

begin;
select plan(50);

-- Clean slate (rolled back at the end) --------------------------------------------------------
delete from public.blog_posts;
delete from private.blog_sync_settings;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000035a1', 'blog-sync-a@example.test'),
  ('00000000-0000-0000-0000-0000000035a2', 'blog-sync-b@example.test');

insert into public.blog_posts (slug, missing_since) values
  ('pgtap-keep', null),
  ('pgtap-dropped', null),
  ('pgtap-relisted', now() - interval '10 days'),
  ('pgtap-gone-29', now() - interval '29 days'),
  ('pgtap-gone-31', now() - interval '31 days');

insert into public.blog_post_votes (post_slug, user_id) values
  ('pgtap-gone-31', '00000000-0000-0000-0000-0000000035a1'),
  ('pgtap-gone-31', '00000000-0000-0000-0000-0000000035a2'),
  ('pgtap-gone-29', '00000000-0000-0000-0000-0000000035a1'),
  ('pgtap-keep',    '00000000-0000-0000-0000-0000000035a1');

-- blog_posts as it stands, for "nothing changed" checks.
create temp table pgtap_before on commit drop as
  select slug, missing_since from public.blog_posts;

-- Shape -----------------------------------------------------------------------------------------
select is_definer(
  'public', 'sync_blog_posts', array['text[]', 'text'],
  'sync_blog_posts runs with its owner''s privileges (it writes blog_posts and reads the private table)'
);

select is(
  (select provolatile::text
     from pg_catalog.pg_proc where oid = 'public.sync_blog_posts(text[], text)'::regprocedure),
  'v',
  'sync_blog_posts is volatile'
);

select ok(
  (select proconfig @> array['search_path=""']
     from pg_catalog.pg_proc where oid = 'public.sync_blog_posts(text[], text)'::regprocedure),
  'sync_blog_posts runs with an empty search_path'
);

select ok(
  has_function_privilege('anon', 'public.sync_blog_posts(text[], text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.sync_blog_posts(text[], text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.sync_blog_posts(text[], text)', 'EXECUTE'),
  'anon, authenticated and service_role can execute sync_blog_posts (the token is the gate)'
);

select ok(
  not has_function_privilege('public', 'public.sync_blog_posts(text[], text)', 'EXECUTE'),
  'PUBLIC cannot execute sync_blog_posts; only the roles granted by name can'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
    and not has_schema_privilege('authenticated', 'private', 'USAGE')
    and not has_schema_privilege('service_role', 'private', 'USAGE')
    and not has_schema_privilege('public', 'private', 'USAGE'),
  'no API role (nor PUBLIC) has USAGE on schema private'
);

select ok(
  not has_table_privilege('anon', 'private.blog_sync_settings', 'SELECT')
    and not has_table_privilege('authenticated', 'private.blog_sync_settings', 'SELECT')
    and not has_table_privilege('service_role', 'private.blog_sync_settings', 'SELECT')
    and not has_table_privilege('anon', 'private.blog_sync_settings', 'UPDATE')
    and not has_table_privilege('authenticated', 'private.blog_sync_settings', 'INSERT'),
  'no API role holds a privilege on private.blog_sync_settings'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
    where oid = 'private.blog_sync_settings'::regclass)
    and not exists (select 1 from pg_catalog.pg_policies
                     where schemaname = 'private' and tablename = 'blog_sync_settings'),
  'private.blog_sync_settings has RLS on and no policies'
);

select is(
  (select array_agg(format('%s:%s:%s', policyname, cmd, array_to_string(roles, ','))
                    order by policyname)
     from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'blog_posts'),
  array['blog_posts_select_all:SELECT:anon,authenticated'],
  'blog_posts keeps exactly 031''s select-all policy'
);

-- A role without the grant is refused at call time. Name the role in the grant: on the local
-- Supabase image `grant ... to current_user` crashes the server process (see the 032 test).
create role pgtap_nobody nologin;
grant pgtap_nobody to postgres;
grant usage on schema extensions to pgtap_nobody;
set local role pgtap_nobody;

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-keep'], 'anything') $$,
  '42501', 'permission denied for function sync_blog_posts',
  'a role without the EXECUTE grant is refused when it calls sync_blog_posts'
);

reset role;

-- The settings table is unreadable to the API roles ----------------------------------------------
set local role anon;

select throws_ok(
  $$ select * from private.blog_sync_settings $$,
  '42501', null,
  'anon cannot read private.blog_sync_settings'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';

select throws_ok(
  $$ select * from private.blog_sync_settings $$,
  '42501', null,
  'a signed-in account cannot read private.blog_sync_settings'
);

reset role;
set local request.jwt.claim.sub = '';

-- No stored hash: every call refused ----------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-new'], 'pgtap-sync-token') $$,
  '42501', 'not authorized',
  'with no settings row, a call is refused'
);

reset role;

insert into private.blog_sync_settings (id, token_sha256) values (true, null);

set local role anon;

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-new'], 'pgtap-sync-token') $$,
  '42501', 'not authorized',
  'with a null hash, a call is refused'
);

reset role;

select throws_ok(
  $$ insert into private.blog_sync_settings (id, token_sha256) values (false, null) $$,
  '23514', null,
  'the settings table holds one row only (id must be true)'
);

select throws_ok(
  $$ update private.blog_sync_settings set token_sha256 = '\x00'::bytea $$,
  '23514', null,
  'a stored hash must be 32 bytes'
);

update private.blog_sync_settings
   set token_sha256 = sha256(convert_to('pgtap-sync-token', 'UTF8'));

-- Wrong or missing token: refused, nothing changes -----------------------------------------------
set local role anon;

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-new'], 'wrong-token') $$,
  '42501', 'not authorized',
  'a wrong token is refused with the generic message'
);

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-new'], null) $$,
  '42501', 'not authorized',
  'a null token is refused the same way'
);

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-new'], 'pgtap-sync-token' || repeat('x', 300)) $$,
  '42501', 'not authorized',
  'an over-long token is refused the same way'
);

select throws_ok(
  $$ select public.sync_blog_posts(null, 'wrong-token') $$,
  '42501', 'not authorized',
  'without the token, a bad list gets the same refusal (the input rules are not revealed)'
);

reset role;

select is_empty(
  $$ (select slug, missing_since from public.blog_posts
      except select slug, missing_since from pgtap_before)
     union all
     (select slug, missing_since from pgtap_before
      except select slug, missing_since from public.blog_posts) $$,
  'refused calls left blog_posts unchanged'
);

-- Malformed lists: the whole call is refused ---------------------------------------------------------
set local role anon;

select throws_ok(
  $$ select public.sync_blog_posts(null, 'pgtap-sync-token') $$,
  '22023', null,
  'a null list is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(array[]::text[], 'pgtap-sync-token') $$,
  '22023', null,
  'an empty list is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(array[['pgtap-a', 'pgtap-b'], ['pgtap-c', 'pgtap-d']], 'pgtap-sync-token') $$,
  '22023', null,
  'a two-dimensional list is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(
       (select array_agg('pgtap-many-' || i) from generate_series(1, 1001) i), 'pgtap-sync-token') $$,
  '22023', null,
  'a list of 1001 slugs is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-would-add', null], 'pgtap-sync-token') $$,
  '22023', null,
  'a list with a null slug is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-would-add', repeat('a', 81)], 'pgtap-sync-token') $$,
  '22023', null,
  'a list with an 81-character slug is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-would-add', 'Not A Slug'], 'pgtap-sync-token') $$,
  '22023', null,
  'a list with a malformed slug is refused'
);

select throws_ok(
  $$ select public.sync_blog_posts(array['pgtap-would-add', 'a--b'], 'pgtap-sync-token') $$,
  '22023', null,
  'a list with a double-hyphen slug is refused'
);

reset role;

select is_empty(
  $$ (select slug, missing_since from public.blog_posts
      except select slug, missing_since from pgtap_before)
     union all
     (select slug, missing_since from pgtap_before
      except select slug, missing_since from public.blog_posts) $$,
  'refused lists left blog_posts unchanged (the valid slug in them was not added)'
);

-- First sync, as anon (what the deploy job uses) ------------------------------------------------------
set local role anon;

select is(
  public.sync_blog_posts(
    array['pgtap-keep', 'pgtap-new', 'pgtap-new', 'pgtap-relisted'], 'pgtap-sync-token'),
  '{"added": 1, "missing": 2, "deleted": 1}'::jsonb,
  'the sync reports 1 added, 2 missing (dropped, gone-29) and 1 deleted (gone-31)'
);

reset role;

select is(
  (select count(*)::int from public.blog_posts where slug = 'pgtap-new' and missing_since is null),
  1,
  'a new slug is added once, as listed (duplicates collapse)'
);

select is(
  (select missing_since from public.blog_posts where slug = 'pgtap-relisted'),
  null::timestamptz,
  'a re-listed slug has missing_since cleared'
);

select is(
  (select missing_since from public.blog_posts where slug = 'pgtap-keep'),
  null::timestamptz,
  'a listed slug stays unmarked'
);

select is(
  (select missing_since from public.blog_posts where slug = 'pgtap-dropped'),
  now(),
  'an unlisted slug is marked missing now'
);

select is(
  (select missing_since from public.blog_posts where slug = 'pgtap-gone-29'),
  now() - interval '29 days',
  'a slug already marked keeps its original date (missing 29 days, not deleted)'
);

select is(
  (select count(*)::int from public.blog_post_votes where post_slug = 'pgtap-gone-29'),
  1,
  'the votes of a post missing 29 days are kept'
);

select is(
  (select count(*)::int from public.blog_posts where slug = 'pgtap-gone-31'),
  0,
  'a post missing 31 days is deleted'
);

select is(
  (select count(*)::int from public.blog_post_votes where post_slug = 'pgtap-gone-31'),
  0,
  'its votes are deleted with it (031''s cascade)'
);

-- Re-run: no-op ----------------------------------------------------------------------------------------
create temp table pgtap_after_first on commit drop as
  select slug, missing_since from public.blog_posts;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000035a1';

select is(
  public.sync_blog_posts(
    array['pgtap-relisted', 'pgtap-new', 'pgtap-keep'], 'pgtap-sync-token'),
  '{"added": 0, "missing": 2, "deleted": 0}'::jsonb,
  'a repeat sync (here as a signed-in caller) adds and deletes nothing and reports the same missing count'
);

reset role;
set local request.jwt.claim.sub = '';

select is_empty(
  $$ (select slug, missing_since from public.blog_posts
      except select slug, missing_since from pgtap_after_first)
     union all
     (select slug, missing_since from pgtap_after_first
      except select slug, missing_since from public.blog_posts) $$,
  'the repeat sync left blog_posts unchanged'
);

-- Counts hide missing posts -----------------------------------------------------------------------------
set local role anon;

select is(
  (select array_agg(slug order by slug collate "C") from public.blog_helpful_counts()),
  array['pgtap-keep', 'pgtap-new', 'pgtap-relisted'],
  'blog_helpful_counts lists only posts that are not missing'
);

select is(
  (select helpful from public.blog_helpful_counts() where slug = 'pgtap-keep'),
  1::bigint,
  'a listed post keeps its count'
);

select is(
  public.blog_helpful_count('pgtap-gone-29'),
  1::bigint,
  'blog_helpful_count still counts a missing post''s votes'
);

select throws_ok(
  $$ update public.blog_posts set missing_since = null where slug = 'pgtap-dropped' $$,
  '42501', null,
  'anon still cannot change blog_posts directly'
);

reset role;

-- Listing a missing post again brings it back --------------------------------------------------------------
set local role anon;

select is(
  public.sync_blog_posts(
    array['pgtap-keep', 'pgtap-new', 'pgtap-relisted', 'pgtap-gone-29', 'pgtap-dropped'],
    'pgtap-sync-token'),
  '{"added": 0, "missing": 0, "deleted": 0}'::jsonb,
  'listing every post again clears all marks'
);

select is(
  (select array_agg(slug order by slug collate "C") from public.blog_helpful_counts()),
  array['pgtap-dropped', 'pgtap-gone-29', 'pgtap-keep', 'pgtap-new', 'pgtap-relisted'],
  'the re-listed posts are back in blog_helpful_counts'
);

reset role;

select is(
  (select count(*)::int from public.blog_post_votes where post_slug = 'pgtap-gone-29'),
  1,
  'a post brought back within 30 days still has its votes'
);

-- 1000 slugs is the limit, not over it (last, since it changes everything above) ----------------
set local role anon;

select lives_ok(
  $$ select public.sync_blog_posts(
       (select array_agg('pgtap-many-' || i) from generate_series(1, 1000) i), 'pgtap-sync-token') $$,
  'a list of exactly 1000 slugs is accepted'
);

reset role;

select is(
  (select count(*)::int from public.blog_posts where slug like 'pgtap-many-%' and missing_since is null),
  1000,
  'all 1000 slugs were added'
);

select * from finish();
rollback;
