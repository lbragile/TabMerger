---
name: deploy-time-lock-order
description: A migration that ALTERs several hot tables must take its locks up front in the order the OLD (still live) functions and FK cascades take them, or it deadlocks (40P01) mid-deploy; lock modes to use and a two-session psql recipe that proves it
metadata:
  type: reference
---

**The function that matters during a deploy is the old one.** While a migration runs, callers
still execute the previous version of every function it replaces (`create or replace` only
becomes visible at commit). So the lock order to match is the live function's, not the one the
file defines. Example (027): 022's `ai_reserve_credits` reads `subscriptions` and
`ai_credit_purchases`, then upserts `ai_usage`. A migration that ALTERs `ai_usage` first and
`ai_credit_purchases` second deadlocks with a reservation caught between its read and its upsert.

**Fix: one `lock table` block right after `set local lock_timeout`,** in the live order:
```sql
lock table public.subscriptions in share row exclusive mode;            -- what CREATE TRIGGER needs
lock table public.ai_credit_purchases, public.ai_usage in access exclusive mode;  -- the ALTERs
```
- `lock table a, b` locks in list order. One statement = one mode, so use two statements when
  the tables need different modes.
- CREATE TRIGGER needs SHARE ROW EXCLUSIVE, which conflicts with writers but not with plain
  readers, so it does not block the `has_cloud_sync()` RLS reads on `subscriptions`. DROP
  TRIGGER needs ACCESS EXCLUSIVE (blocks readers too), so a rollback that drops a trigger locks
  the table that way, still in the same order, inside `begin; set local lock_timeout ...`.
- Leaving the trigger lock on `subscriptions` to the end also deadlocks, with an account
  deletion: the cascade from `auth.users` goes through `profiles` to `subscriptions` (FK
  created in 001) before `ai_usage` (006) and `ai_credit_purchases` (014).
- With the right order the migration only waits (up to lock_timeout) and then fails cleanly.

**Two-session proof without dblink** (dblink needs superuser or a password locally): run two
`docker exec ... psql -f` processes from Bash, A in the background, B one second later.
A: `begin;` the old function's reads, `pg_sleep(3)`, its write, `pg_sleep(1)`, `rollback;`.
B: `begin; \i <migration>; rollback;`. Print `clock_timestamp()` in each step. Run it once with
the lock block and once with it stripped (negative control): the stripped one gives
`ERROR: deadlock detected` in A, the fixed one shows B finishing right after A's rollback. Do
this while the old function is live (after running the migration's rollback by hand), then
re-apply with `psql -1 -f`.

See [[cli-migration-transaction]], [[local-rls-verification]].
