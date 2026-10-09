---
name: cli-migration-atomicity
description: How the Supabase CLI executes a migration file (one implicit transaction per file, with exceptions), so a raise in an end-state check rolls the whole file back
metadata:
  type: reference
---

Checked against the CLI source for v2.118.0 (`apps/cli-go/pkg/migration/file.go`, `ExecBatch`;
the repo moved the Go code under `apps/cli-go/`, so older `pkg/migration/...` URLs 404).

- `db push` (linked or `--db-url`) and `migration up` send every statement of one file, plus the
  insert into `supabase_migrations.schema_migrations`, as a single extended-protocol batch with
  one sync. Postgres treats that as one implicit transaction: an error anywhere (including a
  `raise exception` in a closing `do` block) rolls back the whole file and leaves no history row.
- Exception: statements matching `CREATE [UNIQUE] INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`,
  `REINDEX ... CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM` or `CLUSTER` flush the batch and run on
  their own. A file containing one of those is NOT atomic: statements before it are already
  committed when a later one fails. Flag such files in review and ask for a split.
- The lock a statement takes is held to the end of the file's batch, not just the statement.
  All statements are sent in one go, so the hold time is server execution time, not round trips.
- The CLI sets no `lock_timeout`. A migration that needs ACCESS EXCLUSIVE on a live table queues
  behind any open transaction that touched it, and every later query on that table queues behind
  the migration. Locally `authenticator` has `lock_timeout=8s` and `anon`/`authenticated` have
  3s/8s statement timeouts, so API calls fail rather than hang; the CLI session itself waits.

Related: [[privilege-revoke-review]].
