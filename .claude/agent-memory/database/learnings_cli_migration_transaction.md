---
name: cli-migration-transaction
description: The Supabase CLI applies a migration file as one atomic batch (a failing statement records nothing) that is NOT a transaction block, so LOCK TABLE / SET LOCAL need the file's own begin/commit; how to probe CLI behaviour without touching the real migration history
metadata:
  type: reference
---

**One file = one atomic batch, not a transaction block.** `supabase migration up` and
`supabase db push` send a migration file's statements (plus the `schema_migrations` insert) as
one batch. Postgres runs it atomically: when the last statement raised, a table created earlier
in the file did not exist afterwards and no version was recorded (CLI v2.118). But it is not a
transaction block, so `lock table` fails with 25P01 and `set local` warns and can't be relied
on. A file that needs either must open its own `begin;` ... `commit;`; see
[[cli-batch-needs-begin-commit]].

Consequences:
- `set local lock_timeout = '5s';` right after the file's own `begin;` is the right way to make
  an ACCESS EXCLUSIVE `alter table` fail fast instead of queueing every reader of a hot table
  (`subscriptions`, read by `has_cloud_sync()` on every sync write) behind it.
- An end-state `do` block that raises undoes the whole migration, so it is a real guard.

**Probe recipe (no trace left):** copy `supabase/config.toml` and `supabase/migrations/*.sql`
into `<scratchpad>/wd/supabase/`, add `<next>_probe.sql` whose last statement is
`do $$ begin raise exception 'probe %', current_setting('lock_timeout'); end $$;`, and run
`pnpm exec supabase migration up --local --workdir <scratchpad>/wd`. The error message shows
the value, and the raise rolls the probe back, so `schema_migrations` is unchanged. Delete the
scratch `wd` afterwards so nobody points the CLI at it again. Write the probe with the Write
tool: Bash `printf` treats `%` as a format directive and truncates the SQL.

See [[local-rls-verification]].
