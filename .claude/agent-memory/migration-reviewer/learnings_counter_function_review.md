---
name: counter-function-review
description: Review points for security-definer counter / rate-limit functions that serialize on an advisory lock and upsert fixed-window rows (time capture, in-path cleanup, array args, timeouts)
metadata:
  type: reference
---

Checklist for a plpgsql function that takes `pg_advisory_xact_lock`, reads a counter row, then
`insert ... on conflict do update` (pattern used by 025 rate limits, 022 credit reservation):

- **Read the clock after the lock.** A `clock_timestamp()` captured in `declare` is taken before the
  lock wait. A caller that waited across a window boundary then computes the previous window, finds
  no row for it, and its upsert (`case when c.window_start = excluded.window_start ... else 1`) moves
  a newer row back to the old window with hits = 1. Fix: assign the time after the lock, and only
  reset when `excluded.window_start > c.window_start`. Reproducible in one session by planting a row
  in the next window and calling the function.
- **Cleanup inside the hot path deadlocks.** A `delete ... where window_start < cutoff` run by one
  caller (under its own key's lock) sees the committed, stale version of rows another caller has
  just upserted but not committed, and waits on them; that caller's next upsert for another window
  of the same key can hit a row the delete already locked. Use `for update skip locked` with a
  `limit` in a ctid subquery, or move cleanup to pg_cron / a separate function.
- **Array arguments:** `array_length(a, 1)` accepts 2-D arrays and non-1 lower bounds; `a[i]` then
  returns NULL, so a per-element NULL check is what rejects them. Duplicate window lengths are not
  rejected by length checks and double-count (one row per window length, upserted twice).
- **Timeouts:** locally `authenticator` has `lock_timeout=8s`, `statement_timeout=8s` and preloads
  `safeupdate` (DELETE/UPDATE need a WHERE); `service_role` has no role config. A function-level
  `set lock_timeout` bounds advisory-lock waits (statement_timeout set that way does not affect the
  running statement).
- Advisory keys from `hashtextextended(..., seed)` are 64-bit; a collision only serializes two keys,
  it never merges their counts (rows are keyed separately). Single-bigint and two-int4 advisory
  forms live in separate lock spaces (`objsubid` 1 vs 2).

Related: [[cli-migration-atomicity]], [[privilege-revoke-review]].
