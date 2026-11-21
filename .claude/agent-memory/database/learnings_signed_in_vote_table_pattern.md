---
name: signed-in-vote-table-pattern
description: One-row-per-account client-written table (031 blog_post_votes) - privilege set, anonymous-session check, on-conflict-do-nothing needs no UPDATE, definer count function, how to fake an anonymous JWT in pgTAP
metadata:
  type: reference
---

Pattern from 031 (`blog_post_votes`, proven by `supabase/tests/031_blog_post_votes.test.sql`)
for a table the browser writes directly where the rule is "signed in, once":

- **Uniqueness and validity from constraints, not policies:** PK `(thing, user_id)` refuses a
  second row (23505), an FK to a lookup table refuses made-up keys (23503). `user_id default
  auth.uid()` lets the client omit it; the insert policy still checks it.
- **Privileges:** `revoke all ... from public, anon, authenticated`, then grant exactly what the
  policies allow (`select, insert, delete` to `authenticated`). Platform default ACLs otherwise
  hand both roles `arwdDxt`, including TRUNCATE, which RLS does not cover. See
  [[server-managed-table-pattern]].
- **`insert ... on conflict do nothing` needs INSERT only.** With UPDATE revoked, a re-vote via
  do-nothing is a silent zero-row success, not 42501; `on conflict do update` is the one that
  fails. Assert it with a returning-CTE count, as in [[rls-refusal-shapes]].
- **Anonymous Supabase sessions get the `authenticated` role** with `is_anonymous: true` in the
  JWT. "A real account" needs `((select auth.jwt()) ->> 'is_anonymous')::boolean is not true` in
  the insert check (null-safe for tokens without the claim), even while
  `enable_anonymous_sign_ins = false` in config.toml (hosted settings can differ).
- **Faking that JWT in pgTAP:** `auth.uid()` reads `request.jwt.claim.sub` before
  `request.jwt.claims`, so blank the former (`set local request.jwt.claim.sub = ''`) and put
  `sub` + `is_anonymous` in `request.jwt.claims` JSON, the way PostgREST sets it.
- **Public aggregate over RLS-hidden rows:** a `stable security definer` SQL function returning
  only the count. Use `set search_path = ''` with `pg_catalog.count(*)` and qualified tables (the
  repo convention since 019; migration review asks for it even where `public` would be safe).
  Revoke EXECUTE from PUBLIC and grant it to the roles by name, and pin the PUBLIC revoke in pgTAP
  with `has_function_privilege('public', ...)`.
- **Any new FK to auth.users** takes SHARE ROW EXCLUSIVE on it until commit: `set local
  lock_timeout = '5s'` right after the file's `begin;` (022, 024, 028, 031), and in the rollback.
- **End-state check on policies:** compare `format('%s:%s:%s', policyname, cmd,
  array_to_string(roles, ','))` sorted by name, not names alone; in pgTAP add `policy_cmd_is` /
  `policy_roles_are` per policy (lowercase cmd like `'select'` works). A widened role or command
  under the same name otherwise passes `policies_are`.
- **Policy-layer tests per command:** grant the missing privilege inside the test (SELECT/
  INSERT/DELETE to anon, UPDATE to authenticated), assert 0 rows / 42501, revoke right after.
- **Slug FK:** `on update cascade` so renaming a lookup key carries the votes; slug check
  `char_length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'` (no empty, edge or double
  hyphens).
