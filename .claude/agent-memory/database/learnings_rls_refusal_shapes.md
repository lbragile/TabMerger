---
name: rls-refusal-shapes
description: How an RLS-refused write surfaces per statement type (error vs zero rows) on the has_cloud_sync()-gated tables, and how to assert each in pgTAP, plus a negative-control recipe
metadata:
  type: reference
---

On a table whose insert policy has `with check (owner and has_cloud_sync())` and whose update
policy has the same expression in both `using` and `with check` (the shape from
[[cloud-sync-rls-gap]]), a refused write looks different per statement. Verified on the local
stack; `supabase/tests/019_sessions_paid_gate_rls.test.sql` pins every case for `sessions`.

- **insert** -> error 42501. Assert with `throws_ok(..., '42501', null, ...)`.
- **update / delete of a row the policy hides** -> no error, zero rows. `lives_ok` proves
  nothing here. Assert with a top-level `with x as (update ... returning 1) select is((select
  count(*)::int from x), 0, ...)` and then check the row's content is unchanged.
- **insert ... on conflict (do update or do nothing) on an existing own row** -> error 42501,
  even though the statement would only update or skip: the proposed row is checked against the
  insert policy first. So a non-entitled client upsert fails loudly; it does not turn into a
  silent no-op.
- **update that moves an own row to another user_id** (entitled caller) -> error 42501: the
  row is visible, the result fails `with check`. For a non-entitled caller the same statement
  is zero rows instead, because `using` already hides the row.
- **upsert aimed at another account's existing id** (ids are client-generated text) -> error
  42501. The proposed row passes the insert check; the existing row fails the update `using`,
  and on the conflict path that is an error, not a skip.
- Select and delete policies are owner-only, so non-entitled owners still read and delete.
- `policies_are(...)` belongs in every gate test: policies are permissive (OR-ed), so one
  extra insert/update policy would reopen the gate without any existing assertion noticing.

**Negative control (proves the assertions can fail):** copy the test file to the scratchpad,
insert `create extension if not exists pgtap with schema extensions;` plus a `drop policy` /
`create policy` pair restoring the ungated policy right after `begin;`, `docker cp` it into
`supabase_db_tabmerger` and run it with `psql -U postgres -At -f`. Everything, including the
extension and the policy swap, rolls back with the file's own `rollback;`. The run stops at
the first statement that raises outside `throws_ok`, which is enough to see `not ok` lines.

**Stack is down:** if `docker ps` cannot reach the daemon, starting Docker Desktop brings the
existing `supabase_*_tabmerger` containers back with their data; no `supabase start` or reset
is needed. `pnpm exec supabase test db --local` runs each file in its own rolled-back
transaction and leaves no rows behind (check row counts before and after when the database
holds data).
