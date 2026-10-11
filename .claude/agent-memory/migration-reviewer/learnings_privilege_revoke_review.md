---
name: privilege-revoke-review
description: Checklist for reviewing a migration that makes a table read-only for the API roles (policy drop + revoke + end-state check) - what the catalog functions do and do not see, and what to ask for from hosted projects
metadata:
  type: reference
---

What the catalog checks cover:

- `has_table_privilege(role, table, priv)` includes grants to `PUBLIC` and inherited membership,
  but NOT column-level grants. Pair it with `has_any_column_privilege()` (or `pg_attribute.attacl`)
  when the claim is "role cannot write". A table-level `revoke` does clear that role's
  column-level grants of the same privilege.
- `revoke` only removes grants made by the executing role (or the table owner it is a member of).
  Grants recorded under another grantor are left in place without an error, so an end-state check
  after the revoke is what makes the migration trustworthy. Check `relowner` and the grantor
  after the `/` in each `relacl` entry.
- Platform default ACLs give `anon`/`authenticated` every table privilege (`arwdDxt`), wider than
  a `grant select, insert, update, delete`. TRUNCATE is not subject to RLS; REFERENCES and TRIGGER
  need DDL, which the Data API cannot issue.
- `pg_policies.cmd <> 'SELECT'` also catches `ALL` policies. A `for all using (...)` policy is a
  write policy: with no `with check`, the `using` expression is applied to new rows as well.

Paths a table-level revoke does not close (ask for these in the hosted pre-flight):

- A view over the table owned by a privileged role without `security_invoker`: writes through an
  auto-updatable view run with the view owner's rights.
- `security definer` functions that write the table and are callable through RPC. Functions
  returning `trigger` cannot be called directly.
- Objects created in the dashboard that no migration describes: extra policies, roles, grants.

pgTAP review points:

- SQLSTATE 42501 is raised both for a missing privilege and for an RLS `with check` failure, so
  `throws_ok(insert, '42501')` does not say which layer refused. UPDATE/DELETE do distinguish:
  without the privilege they throw, with the privilege but no policy they match 0 rows.
- `policies_are()` pins policy names only, not command or expression.
- The runner (`postgres`) owns the tables and functions, so a signup inserted by the runner does
  not exercise `security definer`; `is_definer()` covers the attribute, not the auth-service path.
- A good test temporarily re-grants the privilege inside its transaction to test the policy layer
  alone. Never point such a test at a hosted database.

Related: [[cli-migration-atomicity]].
