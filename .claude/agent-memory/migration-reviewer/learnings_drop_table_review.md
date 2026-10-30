---
name: drop-table-review
description: Reviewing a DROP TABLE migration - the lock it takes on the FK parent (auth.users), why SET LOCAL lock_timeout still works in a CLI batch, guard-regex checks, and deploy order against still-deployed code
metadata:
  type: reference
---

- **Parent-table lock.** Dropping a table that has a foreign key removes the internal RI
  triggers on the referenced table, and trigger removal opens that table with ACCESS EXCLUSIVE.
  A table with `references auth.users` therefore locks `auth.users` briefly, and every auth
  lookup queues behind the drop while it waits. That is the real reason for `lock_timeout` on
  such a drop; ask for a header comment that says so.
- **SET LOCAL in a CLI batch.** `ExecSetVariableStmt` warns when not in an explicit transaction
  block but still applies the value with GUC_ACTION_LOCAL. The CLI sends the file as one batch
  (one transaction until Sync), so the setting holds for the rest of the file. Under
  `psql -f` (autocommit per statement) it is a no-op.
- **Ownership on hosted.** `postgres` is not superuser locally or on hosted, yet the drop works:
  dependent objects removed by the dependency walk (RI triggers on `auth.users`) need no
  ownership check. A clean local apply is good evidence for hosted.
- **Guard regex.** `prosrc ~* '\mname\M'`: Postgres ARE word boundaries treat `_` as a word
  character, so `name_old` and `my_name` do not match while `public.name` and `"name"` do. It
  needs `standard_conforming_strings = on`, which is the default. `begin atomic` bodies have empty
  `prosrc` but record dependencies, so RESTRICT covers them. Policy and default expressions also
  record dependencies. Not covered: `cron.job.command` text when pg_cron is installed (hosted
  only), and code outside the DB.
- **Deploy order.** "Nothing reads the table" is usually true of the branch, not of what is
  deployed. `git grep <table> origin/main -- packages` shows whether the live route still
  uses it. If it does, the drop must go out after the web deploy, or the route has to be
  gated off on that environment (e.g. the AI flag).

Related: [[cli-migration-atomicity]].
