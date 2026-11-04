---
name: lease-slots-and-precheck-review
description: Reviewing a per-user lease/slot table (advisory lock + count + insert), a read-only "certainly refused" pre-check against an authoritative reserve function, and pg_cron re-run behaviour; lock modes a new FK to auth.users takes
metadata:
  type: reference
---

Measured locally (PG 15.8, pg_cron 1.6), each in a rolled-back transaction:

- `create table ... references auth.users(id)` takes **SHARE ROW EXCLUSIVE on auth.users**
  (blocks sign-up / sign-in writes, not reads) until the migration file's batch ends. Dropping
  that table later takes ACCESS EXCLUSIVE on auth.users (see [[drop-table-review]]). Ask for
  `set local lock_timeout` in both the migration and its rollback script.
- pg_cron 1.6 `cron.schedule(name, ...)` re-run keeps the same jobid (upsert on name + user) but
  does **not** re-activate a job someone disabled; an end-state check with `and active` then fails
  the re-run. `postgres` cannot UPDATE `cron.job` directly: test with `cron.alter_job(id, active
  := false)` inside `begin ... rollback`. `cron.unschedule(name)` raises when the job is missing,
  so a rollback script using it is not idempotent.

Lease / slot acquire (`pg_advisory_xact_lock` per user, delete expired, count, insert):

- Two callers cannot both take the last slot under READ COMMITTED: each plpgsql statement in a
  volatile function takes a fresh snapshot after the lock, and a commit is visible before its
  xact lock is released. It relies on READ COMMITTED (PostgREST default; check
  `default_transaction_isolation` and role configs). Under REPEATABLE READ the snapshot predates
  the lock and both callers can win.
- Two-session test without changing data: `docker exec <db> psql -c "begin; select acquire(...);
  select pg_sleep(3); rollback;"` in the background, then a second acquire: expect 55P03 after
  the function's lock_timeout.
- If the count includes every row of the user, correctness depends on the expired-row delete; that
  delete can then wait (up to lock_timeout) on rows a skip-locked purge holds. Counting
  `expires_at > now` lets the in-path delete use `for update skip locked` and never wait.

Read-only pre-check that must never be stricter than an authoritative reserve function:

- Prove it as: precheck says refused => for the smallest request the reserve also refuses. Write
  both caps out and look for every term the reserve can add (e.g. `allowance_spent`, packs). A
  term like `greatest(allowance, allowance_spent)` is only bounded by usage if a CHECK constraint
  (not just an UPDATE trigger) enforces `allowance_spent <= credits_used`; triggers miss INSERT.
- A pre-check whose status/tier filter is a superset of the reserve's stays safe when the reserve
  narrows; one that copies the narrower list is only safe if the narrowing migration is applied
  first and never reverted. Same month key must be passed to both (computed once by the caller).
- Best test: a pgTAP grid (statuses x modes x allowance x usage x allowance_spent x pack states)
  asserting zero rows where precheck = true and a 1-credit reserve is allowed, rather than a few
  hand-picked cases.

Related: [[counter-function-review]], [[cli-migration-atomicity]], [[trigger-ddl-locks-and-snapshot-triggers]].
