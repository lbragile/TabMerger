---
name: token-gated-deploy-sync
description: Reviewing an anon-callable security definer RPC gated by a hashed token (deploy-time sync with mark-then-sweep deletion) - what the grace period does and does not guard, seed and hosted pitfalls
metadata:
  type: reference
---

From reviewing 035 (blog_posts deploy sync), 2026-11:

- **Hash-then-compare is fine.** Comparing `sha256(token)` to a stored hash with plain equality
  leaks no useful timing: the attacker controls only the preimage, so learning hash-prefix bytes
  does not help. A leaked hash is harmless only if the token is high-entropy random
  (`openssl rand -hex 32`); a guessable token can be brute-forced offline from the hash.
- **Fail-closed shape to check:** read the hash first, refuse on null hash, null token or
  mismatch with one generic 42501, then validate input, then take the advisory lock. Unauthorized
  callers then cannot hold the lock or learn the input rules.
- **Owner reads an RLS-on, no-policy table:** the definer function sees the row because its
  owner owns the table (owners are exempt unless FORCE RLS). If the owners ever differ, the read
  returns no row and the gate fails closed, the safe direction.
- **Mark-then-sweep grace periods only cover transient bad lists.** A post is deleted only when
  every sync for N days left it out, so a stale preview branch or one bad deploy is harmless. A
  *persistent* partial list (a scanner bug merged to main) is re-sent by every deploy, and the
  sweep deletes rows and their cascaded children after N days anyway. Ask for an alert on
  `missing > 0` / `deleted > 0` in the production job, not just a printed count.
- **Hiding takes effect at once.** A read function that filters out "missing" rows shows a bad
  sync to users immediately, even though deletion waits for the grace period.
- **seed.sql with a public dev token:** `on conflict do update` would overwrite a hosted
  project's real hash if seed ever ran there (Supabase Branching runs seed on preview branches;
  `db push --include-seed`, `db reset --linked`). Prefer `on conflict do nothing` and confirm
  that the hosted preview is a separate project, not a branch.
- **A new `private` schema:** `create schema if not exists` + `comment on schema` fails if the
  schema already exists under another owner. Supabase docs recommend a schema named `private`,
  so check `pg_namespace` on each hosted project first. An empty `nspacl` means only the owner
  has access; the end-state check should still assert no USAGE for PUBLIC and the API roles.
- **Hosted behaviours a vanilla-PG dry run misses:** the anon role's 3s statement_timeout
  includes waiting for an advisory lock (57014, HTTP 500); Security Advisor flags anon-executable
  definer functions (expected, document it); PostgREST maps 42501 to 401/403 depending on JWT
  and 22023 to 400, so scripts should treat any non-2xx response as failure rather than branch
  on the status; the pgrst DDL watcher reloads the schema cache so the RPC is callable right after
  the migration.

Related: [[definer-wrapper-review]], [[privilege-revoke-review]], [[public-vote-table-review]].
