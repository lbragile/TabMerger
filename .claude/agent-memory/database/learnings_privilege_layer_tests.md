---
name: privilege-layer-tests
description: Testing a write-privilege revoke (021/023 pattern) in pgTAP - which assertions actually distinguish the privilege layer from RLS, TRUNCATE ignores RLS, has_any_column_privilege limits, and keeping older policy-layer tests green after a revoke
metadata:
  type: reference
---

Learned writing 023 (read-only `subscriptions`, `ai_usage`, `ai_credit_purchases` for the API
roles) and its negative control (same test with the privileges granted back).

- **Insert assertions don't tell the layers apart.** With no insert policy, RLS refuses an
  insert with 42501 too, so `throws_ok(insert, '42501')` passes with or without the revoke.
  Update, delete and truncate are the assertions that flip: without the privilege they raise
  42501, with it they are silent zero-row statements (RLS) or, for truncate, succeed.
- **TRUNCATE is not subject to RLS.** In the negative control a signed-in role holding
  TRUNCATE emptied the whole table, which then cascaded into later "still reads own row" and
  service-role assertions failing. Expect that cascade in a negative control; it is not a
  test bug. PostgREST has no truncate endpoint, so this only matters for SQL-level paths.
- **`has_any_column_privilege` accepts only SELECT, INSERT, UPDATE, REFERENCES.** Passing
  DELETE or TRUNCATE errors, so loop table-level checks over all four write privileges and
  column-level checks over INSERT/UPDATE only.
- `information_schema.column_privileges` lists table-level grants per column even when
  `pg_attribute.attacl` is null; check `attacl` to find real column-level grants.
- To prove the end-state check catches a column grant, apply the migration, then
  `grant update (col) ...`, then run only the `do` block (`sed -n '/^-- 2. End-state/,$p'`).
  Re-running the whole migration would just revoke the grant again (a table-level revoke also
  removes column grants) and pass.
- **Older tests that asserted the policy layer with a silent zero-row update** start failing
  with 42501 once the privilege is revoked. Keep them testing the policy layer by
  `reset role; grant update on <table> to authenticated;` inside the rolled-back test
  transaction before switching back to the user role, and let the newer test own the
  privilege layer.

See [[server-managed-table-pattern]] and [[rls-refusal-shapes]].
