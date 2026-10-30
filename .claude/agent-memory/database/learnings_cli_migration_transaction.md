---
name: cli-migration-transaction
description: The Supabase CLI applies each migration file as one transaction, so SET LOCAL (e.g. lock_timeout) in a migration works and a failing statement records nothing; how to probe CLI behaviour without touching the real migration history
metadata:
  type: reference
---

**One file = one transaction.** `supabase migration up` sends a migration file's statements
(plus the `schema_migrations` insert) as one batch, which Postgres runs as one transaction.
Verified on CLI v2.118 with a probe migration: `set local lock_timeout = '5s'` was still `5s`
in a later statement of the same file, and when the last statement raised, a table created
earlier in the file did not exist afterwards and no version was recorded.

Consequences:
- `set local lock_timeout = '5s';` at the top of a migration is the right way to make an
  ACCESS EXCLUSIVE `alter table` (e.g. `add column ... check`) fail fast instead of queueing
  every reader of a hot table (`subscriptions`, read by `has_cloud_sync()` on every sync write)
  behind it. 022 does this.
- An end-state `do` block that raises undoes the whole migration, so it is a real guard.
- Don't put `begin;`/`commit;` in migration files; the CLI already wraps them.

**Probe recipe (no trace left):** copy `supabase/config.toml` and `supabase/migrations/*.sql`
into `<scratchpad>/wd/supabase/`, add `<next>_probe.sql` whose last statement is
`do $$ begin raise exception 'probe %', current_setting('lock_timeout'); end $$;`, and run
`pnpm exec supabase migration up --local --workdir <scratchpad>/wd`. The error message shows
the value, and the raise rolls the probe back, so `schema_migrations` is unchanged. Delete the
scratch `wd` afterwards so nobody points the CLI at it again. Write the probe with the Write
tool: Bash `printf` treats `%` as a format directive and truncates the SQL.

See [[local-rls-verification]].
