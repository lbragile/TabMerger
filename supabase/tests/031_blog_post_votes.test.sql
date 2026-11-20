-- pgTAP test for 031_blog_post_votes.sql.
--
-- Run locally with:
--   pnpm exec supabase migration up --local
--   pnpm exec supabase test db
--
-- What it proves: a blog post's Helpful vote is for signed-in accounts only, one per account
-- per post, and only the voter can remove it, even for a client that talks to PostgREST
-- directly with the public anon key. Everyone can read the count.
--
--   anon                         -> no privilege on blog_post_votes (insert refused, 42501);
--                                   with select/insert/delete granted inside this transaction
--                                   the policies still refuse it, so both layers hold on their own
--   a second vote on one post    -> primary key violation (23505)
--   a vote as another account    -> insert policy check fails (42501)
--   an anonymous auth session    -> insert policy check fails (42501)
--   a slug with no blog_posts row -> foreign key violation (23503)
--   editing a vote               -> no UPDATE privilege (42501); with UPDATE granted inside
--                                   this transaction, no update policy matches (zero rows)
--   removing another's vote      -> zero rows, the vote stays
--   blog_helpful_count()         -> callable by anon and authenticated (not PUBLIC), counts
--                                   every account's votes although RLS hides them from the caller
--   post slugs                   -> words of [a-z0-9] joined by single hyphens, at most 80
--                                   characters (23514 otherwise); a rename carries the votes
--
-- Each policy's name, command and roles are pinned (policies_are, policy_cmd_is,
-- policy_roles_are): policies are permissive, so an extra or widened one would reopen the rule.
--
-- Strategy: same as the 019-021 tests. Insert auth.users rows (handle_new_user() creates their
-- profiles), then impersonate each API role with `set local role` + the `request.jwt.claim.sub`
-- GUC that auth.uid() reads. The anonymous-session case sets `request.jwt.claims` the way
-- PostgREST does. Everything runs in one transaction that is rolled back.

begin;
select plan(52);

-- Accounts and a second post ----------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000031a1', 'blog-voter-a@example.test'),
  ('00000000-0000-0000-0000-0000000031a2', 'blog-voter-b@example.test'),
  ('00000000-0000-0000-0000-0000000031a3', 'blog-voter-anon@example.test');

insert into public.blog_posts (slug) values ('pgtap-second-post');

-- Shape ---------------------------------------------------------------------------------------
select policies_are(
  'public', 'blog_posts', array['blog_posts_select_all'],
  'blog_posts has a select policy only'
);

select policies_are(
  'public', 'blog_post_votes',
  array['blog_post_votes_select_own', 'blog_post_votes_insert_own', 'blog_post_votes_delete_own'],
  'blog_post_votes has select/insert/delete-own policies and no update policy'
);

select is_definer(
  'public', 'blog_helpful_count', array['text'],
  'blog_helpful_count runs with its owner''s privileges, so it can count votes RLS hides'
);

select ok(
  not has_table_privilege('anon', 'public.blog_post_votes', 'SELECT')
    and not has_table_privilege('anon', 'public.blog_post_votes', 'INSERT')
    and not has_table_privilege('anon', 'public.blog_post_votes', 'UPDATE')
    and not has_table_privilege('anon', 'public.blog_post_votes', 'DELETE')
    and not has_table_privilege('anon', 'public.blog_post_votes', 'TRUNCATE'),
  'anon holds no privilege on blog_post_votes'
);

select ok(
  has_table_privilege('authenticated', 'public.blog_post_votes', 'SELECT')
    and has_table_privilege('authenticated', 'public.blog_post_votes', 'INSERT')
    and has_table_privilege('authenticated', 'public.blog_post_votes', 'DELETE')
    and not has_table_privilege('authenticated', 'public.blog_post_votes', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.blog_post_votes', 'TRUNCATE'),
  'authenticated may select, insert and delete votes, never update or truncate'
);

select ok(
  has_table_privilege('anon', 'public.blog_posts', 'SELECT')
    and has_table_privilege('authenticated', 'public.blog_posts', 'SELECT')
    and not has_table_privilege('authenticated', 'public.blog_posts', 'INSERT')
    and not has_table_privilege('authenticated', 'public.blog_posts', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.blog_posts', 'DELETE')
    and not has_table_privilege('authenticated', 'public.blog_posts', 'TRUNCATE')
    and not has_table_privilege('anon', 'public.blog_posts', 'INSERT'),
  'blog_posts is read-only for the API roles'
);

select policy_cmd_is('public', 'blog_posts', 'blog_posts_select_all', 'select',
  'blog_posts_select_all is a SELECT policy');
select policy_roles_are('public', 'blog_posts', 'blog_posts_select_all', array['anon', 'authenticated'],
  'blog_posts_select_all applies to anon and authenticated');
select policy_cmd_is('public', 'blog_post_votes', 'blog_post_votes_select_own', 'select',
  'blog_post_votes_select_own is a SELECT policy');
select policy_roles_are('public', 'blog_post_votes', 'blog_post_votes_select_own', array['authenticated'],
  'blog_post_votes_select_own applies to authenticated only');
select policy_cmd_is('public', 'blog_post_votes', 'blog_post_votes_insert_own', 'insert',
  'blog_post_votes_insert_own is an INSERT policy');
select policy_roles_are('public', 'blog_post_votes', 'blog_post_votes_insert_own', array['authenticated'],
  'blog_post_votes_insert_own applies to authenticated only');
select policy_cmd_is('public', 'blog_post_votes', 'blog_post_votes_delete_own', 'delete',
  'blog_post_votes_delete_own is a DELETE policy');
select policy_roles_are('public', 'blog_post_votes', 'blog_post_votes_delete_own', array['authenticated'],
  'blog_post_votes_delete_own applies to authenticated only');

select ok(
  not has_function_privilege('public', 'public.blog_helpful_count(text)', 'EXECUTE'),
  'PUBLIC cannot execute blog_helpful_count; only the roles granted by name can'
);

-- Slug format: words of [a-z0-9] joined by single hyphens, at most 80 characters -------------
select throws_ok(
  $$ insert into public.blog_posts (slug) values ('Not A Slug!') $$,
  '23514', null,
  'a post slug with capitals, spaces or punctuation is refused'
);

select throws_ok(
  $$ insert into public.blog_posts (slug) values (repeat('a', 81)) $$,
  '23514', null,
  'an 81-character slug is refused'
);

select throws_ok(
  $$ insert into public.blog_posts (slug) values ('') $$,
  '23514', null,
  'an empty slug is refused'
);

select throws_ok(
  $$ insert into public.blog_posts (slug) values ('a--b') $$,
  '23514', null,
  'a slug with a double hyphen is refused'
);

select throws_ok(
  $$ insert into public.blog_posts (slug) values ('-x') $$,
  '23514', null,
  'a slug starting with a hyphen is refused'
);

select throws_ok(
  $$ insert into public.blog_posts (slug) values ('x-') $$,
  '23514', null,
  'a slug ending with a hyphen is refused'
);

select lives_ok(
  $$ insert into public.blog_posts (slug) values (repeat('a', 39) || '-' || repeat('b', 40)) $$,
  'an 80-character slug is accepted'
);

-- anon: cannot vote, can read posts and counts ------------------------------------------------
set local role anon;

select throws_ok(
  $$ insert into public.blog_post_votes (post_slug, user_id)
     values ('save-all-open-tabs', '00000000-0000-0000-0000-0000000031a1') $$,
  '42501', null,
  'anon cannot insert a vote'
);

select is(
  (select count(*)::int from public.blog_posts where slug = 'save-all-open-tabs'),
  1,
  'anon can read the seeded post'
);

select is(
  public.blog_helpful_count('save-all-open-tabs'),
  0::bigint,
  'anon reads a count of 0 before anyone votes'
);

reset role;

-- Voter A -------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';

select lives_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('save-all-open-tabs') $$,
  'a signed-in account can vote; user_id defaults to auth.uid()'
);

select is(
  (select user_id from public.blog_post_votes where post_slug = 'save-all-open-tabs'),
  '00000000-0000-0000-0000-0000000031a1'::uuid,
  'the vote is recorded under the caller'
);

select throws_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('save-all-open-tabs') $$,
  '23505', null,
  'a second vote on the same post is refused'
);

with again as (
  insert into public.blog_post_votes (post_slug)
  values ('save-all-open-tabs')
  on conflict do nothing
  returning 1
)
select is(
  (select count(*)::int from again),
  0,
  'an "insert ... on conflict do nothing" re-vote adds no row (what an idempotent client upsert does)'
);

select throws_ok(
  $$ insert into public.blog_post_votes (post_slug, user_id)
     values ('save-all-open-tabs', '00000000-0000-0000-0000-0000000031a2') $$,
  '42501', null,
  'an account cannot vote as another account'
);

select throws_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('no-such-post') $$,
  '23503', null,
  'a vote on a slug with no blog_posts row is refused'
);

select throws_ok(
  $$ update public.blog_post_votes set created_at = now() - interval '1 year'
      where post_slug = 'save-all-open-tabs' $$,
  '42501', null,
  'a vote cannot be edited'
);

select throws_ok(
  $$ insert into public.blog_posts (slug) values ('made-up-post') $$,
  '42501', null,
  'a signed-in account cannot add a post'
);

select lives_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('pgtap-second-post') $$,
  'the same account can vote once on another post'
);

reset role;

-- Voter B -------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a2';

select is(
  (select count(*)::int from public.blog_post_votes),
  0,
  'an account sees no other account''s votes'
);

select lives_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('save-all-open-tabs') $$,
  'a second account can vote on the same post'
);

select is(
  public.blog_helpful_count('save-all-open-tabs'),
  2::bigint,
  'blog_helpful_count counts every account''s votes for a signed-in caller'
);

with removed as (
  delete from public.blog_post_votes
   where user_id = '00000000-0000-0000-0000-0000000031a1'
  returning 1
)
select is(
  (select count(*)::int from removed),
  0,
  'an account cannot delete another account''s vote'
);

reset role;

select is(
  (select count(*)::int from public.blog_post_votes
    where user_id = '00000000-0000-0000-0000-0000000031a1'),
  2,
  'voter A''s votes survived voter B''s delete'
);

-- anon reads the count other accounts produced -------------------------------------------------
set local role anon;
set local request.jwt.claim.sub = '';

select is(
  public.blog_helpful_count('save-all-open-tabs'),
  2::bigint,
  'anon reads the count of every account''s votes'
);

select is(
  public.blog_helpful_count('no-such-post'),
  0::bigint,
  'an unknown slug counts 0'
);

reset role;

-- Voter A removes their own vote ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';

with removed as (
  delete from public.blog_post_votes where post_slug = 'save-all-open-tabs'
  returning 1
)
select is(
  (select count(*)::int from removed),
  1,
  'an account can delete its own vote (and only its own row matched)'
);

select is(
  public.blog_helpful_count('save-all-open-tabs'),
  1::bigint,
  'the count drops after the vote is removed'
);

reset role;

-- An anonymous auth session is not an account ------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '';
set local request.jwt.claims =
  '{"sub": "00000000-0000-0000-0000-0000000031a3", "role": "authenticated", "is_anonymous": true}';

select throws_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('save-all-open-tabs') $$,
  '42501', null,
  'an anonymous sign-in cannot vote'
);

set local request.jwt.claims =
  '{"sub": "00000000-0000-0000-0000-0000000031a3", "role": "authenticated", "is_anonymous": false}';

select lives_ok(
  $$ insert into public.blog_post_votes (post_slug) values ('save-all-open-tabs') $$,
  'the same account votes once its session is not anonymous (claims set as PostgREST does)'
);

reset role;
set local request.jwt.claims = '';

-- Policy layer on its own: with the privileges granted inside this transaction, the policies ------
-- still refuse anon everything and refuse the owner an edit. Each grant is revoked right after.
grant select, insert, delete on table public.blog_post_votes to anon;
set local role anon;

select throws_ok(
  $$ insert into public.blog_post_votes (post_slug, user_id)
     values ('pgtap-second-post', '00000000-0000-0000-0000-0000000031a2') $$,
  '42501', null,
  'with INSERT granted, anon is still refused by the policies (they apply to authenticated only)'
);

select is(
  (select count(*)::int from public.blog_post_votes),
  0,
  'with SELECT granted, anon still sees no vote'
);

with removed as (
  delete from public.blog_post_votes returning 1
)
select is(
  (select count(*)::int from removed),
  0,
  'with DELETE granted, anon still deletes no vote'
);

reset role;
revoke select, insert, delete on table public.blog_post_votes from anon;

grant update on table public.blog_post_votes to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000031a1';

with edited as (
  update public.blog_post_votes set created_at = now() - interval '1 year'
   where post_slug = 'pgtap-second-post'
  returning 1
)
select is(
  (select count(*)::int from edited),
  0,
  'with UPDATE granted, the owner still cannot edit a vote (there is no update policy)'
);

reset role;
revoke update on table public.blog_post_votes from authenticated;
set local request.jwt.claim.sub = '';

-- Cascades ------------------------------------------------------------------------------------------
delete from auth.users where id = '00000000-0000-0000-0000-0000000031a2';

select is(
  (select count(*)::int from public.blog_post_votes
    where user_id = '00000000-0000-0000-0000-0000000031a2'),
  0,
  'deleting an account deletes its votes'
);

update public.blog_posts set slug = 'pgtap-renamed-post' where slug = 'pgtap-second-post';

select is(
  (select count(*)::int from public.blog_post_votes where post_slug = 'pgtap-renamed-post'),
  1,
  'renaming a post''s slug carries its votes along'
);

delete from public.blog_posts where slug = 'pgtap-renamed-post';

select is(
  (select count(*)::int from public.blog_post_votes where post_slug = 'pgtap-renamed-post'),
  0,
  'deleting a post deletes its votes'
);

select * from finish();
rollback;
