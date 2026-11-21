-- pgTAP test for 032_blog_helpful_counts.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: blog_helpful_counts() gives everyone (anon included) every post's Helpful count
-- in one call, and each count is exactly what blog_helpful_count(slug) returns, even though RLS
-- hides other accounts' votes from the caller (the inner blog_helpful_count is the definer; this
-- function runs as the caller). It exposes slugs and counts only, never voters.
--
--   shape        -> security invoker, stable, empty search_path, no arguments, result columns
--                   exactly (slug text, helpful bigint); executable by anon, authenticated and
--                   service_role, not PUBLIC
--   a role without the grant -> refused at call time (42501), not only in the catalog
--   a post with no votes -> 0
--   every slug   -> equals blog_helpful_count(slug) and a direct count of blog_post_votes, for
--                   anon and for a signed-in caller who sees only their own vote
--   one row per post -> no slug missing or repeated
--
-- Strategy: same as the 031 test. Insert auth.users rows and votes as the test runner (the table
-- owner, so RLS does not apply to it), then call the function as `anon` and as `authenticated`
-- with `request.jwt.claim.sub` set. Everything runs in one transaction that is rolled back.

begin;
select plan(19);

-- Accounts, posts and votes ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000032a1', 'blog-counts-a@example.test'),
  ('00000000-0000-0000-0000-0000000032a2', 'blog-counts-b@example.test'),
  ('00000000-0000-0000-0000-0000000032a3', 'blog-counts-c@example.test');

insert into public.blog_posts (slug) values
  ('pgtap-counts-none'),
  ('pgtap-counts-one'),
  ('pgtap-counts-three');

insert into public.blog_post_votes (post_slug, user_id) values
  ('pgtap-counts-one',   '00000000-0000-0000-0000-0000000032a1'),
  ('pgtap-counts-three', '00000000-0000-0000-0000-0000000032a1'),
  ('pgtap-counts-three', '00000000-0000-0000-0000-0000000032a2'),
  ('pgtap-counts-three', '00000000-0000-0000-0000-0000000032a3');

-- Shape -------------------------------------------------------------------------------------------
select isnt_definer(
  'public', 'blog_helpful_counts', array[]::name[],
  'blog_helpful_counts runs as the caller, so blog_posts policies apply to it'
);

select is(
  (select provolatile::text
     from pg_catalog.pg_proc where oid = 'public.blog_helpful_counts()'::regprocedure),
  's',
  'blog_helpful_counts is stable'
);

select ok(
  (select proconfig @> array['search_path=""']
     from pg_catalog.pg_proc where oid = 'public.blog_helpful_counts()'::regprocedure),
  'blog_helpful_counts runs with an empty search_path'
);

select is(
  (select format('%s|%s|%s', pronargs, array_to_string(proargnames, ','),
                 array_to_string(proallargtypes::regtype[], ','))
     from pg_catalog.pg_proc where oid = 'public.blog_helpful_counts()'::regprocedure),
  '0|slug,helpful|text,bigint',
  'blog_helpful_counts takes no arguments and returns exactly (slug text, helpful bigint)'
);

select ok(
  has_function_privilege('anon', 'public.blog_helpful_counts()', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.blog_helpful_counts()', 'EXECUTE')
    and has_function_privilege('service_role', 'public.blog_helpful_counts()', 'EXECUTE'),
  'anon, authenticated and service_role can execute blog_helpful_counts'
);

select ok(
  not has_function_privilege('public', 'public.blog_helpful_counts()', 'EXECUTE'),
  'PUBLIC cannot execute blog_helpful_counts; only the roles granted by name can'
);

-- A role that holds only what PUBLIC holds (schema usage, no EXECUTE) is refused at call time.
-- The runner (postgres) must be a member to `set role` to it. Name the role: on the local
-- Supabase image `grant ... to current_user` crashes the server process (signal 11). It also
-- needs USAGE on the extensions schema, where pgTAP's own functions live.
create role pgtap_nobody nologin;
grant pgtap_nobody to postgres;
grant usage on schema extensions to pgtap_nobody;
set local role pgtap_nobody;

select throws_ok(
  $$ select * from public.blog_helpful_counts() $$,
  '42501', 'permission denied for function blog_helpful_counts',
  'a role without the EXECUTE grant is refused when it calls blog_helpful_counts'
);

reset role;

-- anon ----------------------------------------------------------------------------------------------
set local role anon;

select is(
  (select helpful from public.blog_helpful_counts() where slug = 'pgtap-counts-none'),
  0::bigint,
  'a post with no votes counts 0 (it is listed, not left out)'
);

select is(
  (select helpful from public.blog_helpful_counts() where slug = 'pgtap-counts-one'),
  1::bigint,
  'a post with one vote counts 1'
);

select is(
  (select helpful from public.blog_helpful_counts() where slug = 'pgtap-counts-three'),
  3::bigint,
  'anon reads the count of every account''s votes'
);

select is_empty(
  $$ select coalesce(p.slug, c.slug)
       from public.blog_posts p
       full join public.blog_helpful_counts() c on c.slug = p.slug
      where p.slug is null
         or c.slug is null
         or c.helpful is distinct from public.blog_helpful_count(p.slug) $$,
  'for anon, every post''s count equals blog_helpful_count(slug), with no post missing or extra'
);

select is(
  (select count(*)::int from public.blog_helpful_counts()),
  (select count(*)::int from public.blog_posts),
  'one row per post'
);

select is(
  (select count(distinct slug)::int from public.blog_helpful_counts()),
  (select count(*)::int from public.blog_helpful_counts()),
  'no slug is listed twice'
);

select is(
  (select array_agg(distinct k order by k)
     from public.blog_helpful_counts() r, jsonb_object_keys(to_jsonb(r)) k),
  array['helpful', 'slug'],
  'each row (as PostgREST serialises it) has only slug and helpful, nothing about voters'
);

reset role;

-- A signed-in caller sees only their own vote, but the counts are everyone's ---------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000032a2';

select is(
  (select count(*)::int from public.blog_post_votes where post_slug = 'pgtap-counts-three'),
  1,
  'RLS shows the signed-in caller only their own vote'
);

select is(
  (select helpful from public.blog_helpful_counts() where slug = 'pgtap-counts-three'),
  3::bigint,
  'a signed-in caller reads the count of every account''s votes'
);

select is_empty(
  $$ select coalesce(p.slug, c.slug)
       from public.blog_posts p
       full join public.blog_helpful_counts() c on c.slug = p.slug
      where p.slug is null
         or c.slug is null
         or c.helpful is distinct from public.blog_helpful_count(p.slug) $$,
  'for a signed-in caller, every post''s count equals blog_helpful_count(slug)'
);

reset role;
set local request.jwt.claim.sub = '';

-- Against the table itself (the runner owns it, so RLS does not filter this) ----------------------
select is_empty(
  $$ select c.slug
       from public.blog_helpful_counts() c
      where c.helpful <> (select count(*) from public.blog_post_votes v
                           where v.post_slug = c.slug) $$,
  'every count equals a direct count of that post''s blog_post_votes rows'
);

-- A removed vote is reflected -----------------------------------------------------------------------
delete from public.blog_post_votes
 where post_slug = 'pgtap-counts-three' and user_id = '00000000-0000-0000-0000-0000000032a3';

set local role anon;

select is(
  (select helpful from public.blog_helpful_counts() where slug = 'pgtap-counts-three'),
  2::bigint,
  'the count drops after a vote is removed'
);

reset role;

select * from finish();
rollback;
