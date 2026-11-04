---
name: pg-cron-in-migrations
description: Scheduling database housekeeping with pg_cron from a migration (026 rate-limit purge) - availability, idempotent cron.schedule, which role the job runs as, and how to check it locally
metadata:
  type: reference
---

Used by 026 for `rate_limit_purge()`; the same recipe fits any periodic cleanup that should not
run on a request path.

- **Available everywhere we deploy.** `pg_cron` (1.6 locally) is in `shared_preload_libraries`
  of the Supabase Postgres image, hosted and local, so `create extension if not exists pg_cron
  with schema pg_catalog;` works inside a migration (the extension creates its own `cron`
  schema). Enabling it locally granted the API roles no usage on `cron`; 026's test asserts that.
- **Idempotent by name.** `select cron.schedule('job-name', '*/10 * * * *', $c$...$c$)` updates
  the existing job when the name exists (same `jobid`), so a re-run migration doesn't duplicate
  it. Rollback is `select cron.unschedule('job-name')`, before dropping the function it calls.
- **Runs as the scheduling role.** `cron.job.username` is the role that ran `cron.schedule`
  (`postgres` for CLI migrations), which owns our security-definer functions, so the job needs
  no extra grant even when EXECUTE is revoked from PUBLIC.
- **End-state check:** assert the row in `cron.job` (jobname, schedule, command, active) in the
  migration's `do` block; a missing or edited job then fails the migration.
- **History grows:** every run adds a row to `cron.job_run_details`; a 10-minute job adds about
  52k rows a year. Fine, but worth a cleanup job if more schedules are added.
- **Purge shape that can't deadlock with writers:**
  `delete ... where ctid = any(array(select ctid ... order by <indexed col> limit n for update skip locked))`
  never waits on a lock, so it can't form a cycle with a function that holds an advisory lock
  and upserts rows. Verify it by hand: one `docker exec ... psql` session locks a stale row
  `for update` and sleeps in the background, a second calls the purge inside `begin ... rollback`
  and must return immediately with that row skipped.

Related: [[counter-function-review]], [[cli-migration-transaction]], [[local-rls-verification]].
