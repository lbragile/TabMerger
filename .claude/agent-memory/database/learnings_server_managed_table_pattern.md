---
name: server-managed-table-pattern
description: How a server-written table is locked to read-only for API roles (021 on profiles) - select-only policy plus privilege revoke plus an end-state check; what the default ACLs really grant
metadata:
  type: reference
---

`profiles` is server-managed since migration 021: `profiles_select_own` is its only policy and
`anon`/`authenticated` hold SELECT only. Writers are `handle_new_user()` (security definer, runs
as its owner whoever inserts the auth user) and the service role (billing webhook).

Pattern for any table whose rows only the server writes:
- Two layers, each tested on its own: no write policy (a write matches no row, silently) and no
  write privilege (a write fails with 42501, HTTP 403 from PostgREST). The privilege layer is
  the one that still holds if someone later adds a policy.
- Inspect `pg_class.relacl` instead of trusting migration 010's text. The platform default ACLs
  give `anon`/`authenticated` every table privilege (`arwdDxt`), so the revoke list is
  `insert, update, delete, truncate`. TRUNCATE is not subject to RLS (PostgREST has no truncate
  endpoint, so this is belt and braces).
- `revoke` and `drop policy if exists` are no-ops when already done, so the migration is safe to
  re-run. A table-level revoke also removes matching column-level grants.
- End with a `do` block that raises unless `has_table_privilege()` and `pg_policies` show the
  intended end state. Local and hosted databases can differ (hand-made policies, extra grants),
  and a loud failure beats a migration that records success while leaving the table writable.
- Rollback for such a migration is the inverse grant plus re-creating the policy; verify it by
  running migration, rollback, migration inside one `begin ... rollback` and comparing `relacl`.
- Before narrowing, confirm no column is user-edited and grep every `.from('<table>')` call
  site for update/upsert/insert/delete with a user-session client; a user-edited column needs a
  column-level grant instead.
