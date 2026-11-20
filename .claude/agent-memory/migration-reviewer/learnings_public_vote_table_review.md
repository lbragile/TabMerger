---
name: public-vote-table-review
description: Review points for a per-account vote/like table (owner-only RLS + security definer public count), incl. catalog facts checked on the local stack and pgTAP functions that pin policy shape
metadata:
  type: reference
---

Checked on the local stack (2026-11, reviewing 031 blog votes):

- `public` schema ACL: anon/authenticated hold USAGE only, no CREATE. pg_catalog is searched
  first implicitly, so `set search_path = public` on a definer function cannot be shadowed by
  an API role; the repo convention since 019 is still `set search_path = ''` (fully qualified
  body) and end-state checks test `proconfig @> array['search_path=""']`.
- Default ACLs: functions created by postgres grant EXECUTE to anon/authenticated/service_role
  directly, so `revoke execute ... from public` alone does not close a function; tables get
  `arwdDxt` for the API roles, so `revoke all` then a narrow grant is needed.
- `postgres` has BYPASSRLS locally, so a definer function owned by it sees rows RLS hides.
- `auth.uid()` = claim.sub GUC, else `request.jwt.claims ->> 'sub'`; `auth.jwt()` = the
  `request.jwt.claim` GUC, else `request.jwt.claims`. A test can blank claim.sub and set claims
  as PostgREST does (needed for `is_anonymous`).
- `pg_policies.roles` is ordered by rolname, so an end-state check can compare
  `format('%s:%s:%s', policyname, cmd, array_to_string(roles, ','))` arrays exactly. Checking
  names alone (and pgTAP `policies_are`) misses a policy edited to `for all` or to `public`.
  pgTAP has `policy_cmd_is()` and `policy_roles_are()` for this.
- No UPDATE privilege means supabase-js `.upsert()` (default merge-duplicates = ON CONFLICT DO
  UPDATE) fails 42501; the client must `.insert()` (treat 23505 as done) or pass
  `ignoreDuplicates: true` (ON CONFLICT DO NOTHING).
- "No update" proven by both layers: the privilege test throws 42501; the policy layer needs
  `grant update` inside the test transaction, then the owner's update matching 0 rows.
- A new FK to auth.users takes SHARE ROW EXCLUSIVE on it; ask for `set local lock_timeout`
  (repo uses '5s', see 022/024) in the migration and its rollback ([[lease-slots-and-precheck-review]]).

Related: [[privilege-revoke-review]], [[cli-migration-atomicity]].
