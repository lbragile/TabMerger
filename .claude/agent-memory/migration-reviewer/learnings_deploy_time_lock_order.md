---
name: deploy-time-lock-order
description: While a migration runs, the OLD function body is the live one, so ACCESS EXCLUSIVE order must follow the deployed version's statement order; two-session deadlock repro; CHECK add / NOT VALID inside one CLI file; peek-vs-take parity checks
metadata:
  type: reference
---

Lock order during deploy (measured on local PG 15.8, every transaction rolled back):

- A migration that changes a function and alters the tables it reads runs against callers of
  the **currently deployed** body, not the new one. Take the ACCESS EXCLUSIVE locks in the order
  the deployed body takes its table locks. A plpgsql function locks per statement as it runs, so
  "stmt 1 reads A, B; stmt 2 upserts C" holds A and B while it waits on C. A migration that takes
  AE on C and then B deadlocks with it; taking B and then C does not.
- Repro without touching data: session 1 runs `begin; select count(*) from A, B where false;
  select pg_sleep(2); insert into C ... select ... where false; rollback;` in the background;
  session 2 runs the migration's ALTERs in `begin ... rollback` 0.7 s later. A wrong order
  gives `40P01 deadlock detected` on one side; swapping the order gives a clean wait.
- Either side can be the victim. If the migration loses, that file rolls back and `db push`
  stops there (a rerun is safe). If the caller loses, one API request fails with 40P01.
- `LOCK TABLE b, c IN ACCESS EXCLUSIVE MODE` at the top of the file fixes the order explicitly
  and is easier to check in review than the order of the ALTERs.

CHECK constraint added in the same file as its new nullable column:

- `add column` already holds ACCESS EXCLUSIVE until the end of the file, so `NOT VALID` +
  `VALIDATE` in the same file gains nothing (the lock is already held and VALIDATE still scans).
  It only helps when the VALIDATE runs in a later file or transaction. For a small table the
  validation scan of an all-NULL column costs milliseconds. An end-state check that requires
  `convalidated` would reject a NOT VALID constraint anyway.

Read-only "peek" twin of a counting function: diff its argument checks and edge branches against
the counting one (duplicate windows, a stored window newer than now). Any branch the peek leaves
out makes it more lenient, which is acceptable only if the counting call still decides.

Related: [[trigger-ddl-locks-and-snapshot-triggers]], [[lease-slots-and-precheck-review]], [[cli-migration-atomicity]].
