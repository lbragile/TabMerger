---
name: trigger-ddl-locks-and-snapshot-triggers
description: Lock modes of trigger/column DDL measured on PG 15 (DROP TRIGGER IF EXISTS = ACCESS EXCLUSIVE even when missing), lock-order deadlocks with multi-table readers, and review points for triggers that record a value when an allowance drops
metadata:
  type: reference
---

Lock modes, measured locally (PG 15.8) by running each statement in a rolled-back
transaction and reading `pg_locks` for `pg_backend_pid()`:

- `drop trigger if exists x on t` takes **ACCESS EXCLUSIVE on t even when the trigger does not
  exist** (RemoveObjects opens the table with AccessExclusiveLock before it looks the trigger up).
  In a CLI migration that lock is held to the end of the file, so every reader of `t` (e.g.
  `subscriptions` behind `has_cloud_sync()` RLS) queues behind it.
- `create trigger` and `create or replace trigger` (PG14+) take SHARE ROW EXCLUSIVE, which blocks
  writes only, not reads. Ask for `create or replace trigger` instead of drop + create.
- `alter table ... add column if not exists` takes ACCESS EXCLUSIVE even when the column already
  exists (no-op rerun still locks). Adding a column with a CHECK in the same ALTER also scans the
  table to validate it, all rows being null.

Lock-order deadlocks: a plpgsql function whose single statement reads tables A, B, C (scalar
subqueries) takes ACCESS SHARE on them in text order. A migration that takes ACCESS EXCLUSIVE on
C, then B, then A can deadlock with a call that already holds A and is waiting on B. The
detector (deadlock_timeout 1s) aborts one side: either the atomic migration (rerun) or the
caller (40P01). The fix is to take the exclusive locks in the readers' order, and avoid ACCESS
EXCLUSIVE on hot tables altogether.

Triggers that record a value when an allowance drops (e.g. "allowance spent so far" written to
a usage row when the monthly allowance goes to 0):

- Guard on the OLD row being actually entitled (tier, mode, status), not just `old.value > 0`.
  Rows can carry a positive allowance while not entitled (written by older code), and recording
  `least(old allowance, used)` there grants back credits that were never paid by the allowance.
  Reproduce in a rolled-back transaction: non-entitled row with allowance > 0, spend packs,
  set allowance to 0, reserve again.
- Overwriting the recorded value on a second drop within the same period loses the earlier figure
  if the allowance changed in between; `greatest(coalesce(existing, 0), new)` keeps it.
- A reserve function that computes the cap in one statement and upserts in the next uses a
  stale cap if the drop commits in between (the upsert's WHERE is re-checked against the latest
  row, but the cap is a constant). Bounded by in-flight requests. Closing it: a separate
  `select ... for share` on the entitlement row before computing the cap, so the cap statement
  takes a fresh snapshot after the drop commits.
- A BEFORE UPDATE clamp trigger does not cover INSERT; if the invariant is claimed for every
  row, ask for a CHECK constraint too (the BEFORE trigger runs before the CHECK, so clamping
  still works).

Related: [[cli-migration-atomicity]], [[counter-function-review]], [[drop-table-review]].
