---
name: drop-table-dependency-check
description: Dropping a table safely - what plain DROP TABLE (RESTRICT) already refuses, what it misses (function bodies), the pg_depend query to run first, and the guard pattern 024 uses
metadata:
  type: reference
---

**What RESTRICT covers.** A plain `drop table` (no CASCADE) already fails on dependent views,
materialized views and foreign keys from other tables, because those record a `pg_depend` row.
Its own objects go with it silently: row type, toast table, column defaults, PK/FK constraints,
the internal `RI_ConstraintTrigger_*` triggers, RLS policies, grants and publication
membership.

**What it misses.** A `plpgsql` or string-bodied `sql` function that names the table records
no dependency, so the drop succeeds and the function fails only when it is next called. Only
`begin atomic` SQL-standard bodies are tracked. 024 therefore guards with
`p.prosrc ~* '\morganize_runs\M'` over `pg_proc` (excluding `pg_catalog` and
`information_schema`) and raises before the drop. That check runs on every hosted project, so
it also catches functions made by hand in the dashboard that no migration shows.

**Pre-check on the local stack:**
`select pg_describe_object(classid, objid, objsubid), deptype from pg_depend where refobjid =
'public.<t>'::regclass;` (anything other than the table's own objects is a real dependent),
plus `information_schema.view_table_usage`, `pg_constraint where confrelid = ...`,
`pg_publication_tables`, and the `prosrc` search above.

**Testing the guard:** inside `begin; ... rollback;`, create a throwaway function whose body
names the table, `\i` the migration with `ON_ERROR_STOP off`, and confirm the raise and that
the table still exists after the rollback.

**Scratchpad is shared** with other agents in the same session folder: give scratch files a
migration-specific prefix (`drop024_*.sql`). A generic name like `deps.sql` already existed
there, and Write refused to overwrite it.

See [[local-rls-verification]], [[cli-migration-transaction]].
