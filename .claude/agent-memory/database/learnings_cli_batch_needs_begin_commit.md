---
name: cli-batch-needs-begin-commit
description: Supabase CLI db push / migration up don't wrap a migration file in a transaction block; set local is unreliable and LOCK TABLE fails (25P01) unless the file has its own begin/commit; psql -1 hides this locally, so test with supabase migration up --local
metadata:
  type: reference
---

**The CLI batch is not a transaction block.** `supabase db push` and `supabase migration up`
(CLI v2.118, Postgres 15) send a file's statements, then the `schema_migrations` insert, as one
extended-protocol batch. Postgres treats that as an implicit transaction (atomic until Sync), but
not as a transaction block, so:

- `lock table ...` fails: `ERROR: LOCK TABLE can only be used in transaction blocks (SQLSTATE
  25P01)`. Reproduced locally through `migration up --local` and on a hosted project via
  `db push`.
- `set local ...` warns ("can only be used in transaction blocks"). Locally the value still held
  for the rest of the batch; on the hosted push it was reported as a no-op. Don't rely on it.
- Other statements are fine: a raise late in the file still rolls the whole batch back and no
  version is recorded.

**Fix: the file opens its own transaction.** `begin;` right after the header comments,
`commit;` as the last line, end-state `do` checks inside. Verified via the CLI path (027, 028):
- both apply and are recorded; the recorded `statements` array starts with `begin` and ends with
  `commit`, and the history insert runs after the COMMIT in the same batch;
- an error injected before `commit;` rolled back the whole file, no version recorded, no
  connection left idle in transaction;
- with another session holding a lock on a table the file locks, it failed after 5s with 55P03,
  so `set local lock_timeout` now really applies.
Everything common in a migration is allowed in a block (DDL, `create extension if not exists`,
`cron.schedule`/`cron.alter_job`, `do` blocks). Not allowed: `create index concurrently`,
`vacuum`, `alter system`, and using an enum value added by `alter type ... add value` in the
same transaction; such a file must not have a `begin;`.

**psql -1 hides it.** `psql -1 -f file.sql` wraps the file in BEGIN/COMMIT, so a file that only
works inside a block passes. Before pushing, apply new migrations through the CLI executor:
`supabase migration up --local` (after rolling them back by hand and deleting their
`supabase_migrations.schema_migrations` rows), or probe a scratch copy with `--workdir` as in
[[cli-migration-transaction]].

Rollback notes that use `set local` or `lock table` should spell out `begin;` ... `commit;` too.

See [[deploy-time-lock-order]].
