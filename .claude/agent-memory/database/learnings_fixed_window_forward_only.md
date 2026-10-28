---
name: fixed-window-forward-only
description: Semantics for a fixed-window counter whose reset must never move a window back (026 rate_limit_take) - what a stale caller gets, guarding the upsert, and lock_timeout on advisory locks
metadata:
  type: reference
---

Decisions in 026 for `rate_limit_take()`, reusable for any counter keyed by a time window.

- **Read the clock after the lock.** Assign `v_now := clock_timestamp()` after
  `pg_advisory_xact_lock`. Per key, callers are then serialized and each reads a later time,
  so a "stale" caller only happens when the server clock steps back.
- **Stale caller = refused, not counted.** In the check phase, read the key's row without
  filtering on `window_start`. If the stored window is newer than the caller's, refuse with
  `retry_after = ceil(stored_start - now)` (at least 1) and write nothing. Counting the hit in
  the newer window would need an increment the caller can't justify; resetting it would undo
  other callers' hits.
- **Guard the upsert anyway, and check it.** `on conflict ... do update ... where
  excluded.window_start >= c.window_start` can make the upsert affect 0 rows. Follow it with
  `get diagnostics n = row_count` and raise (026 uses `40001`) when `n <> 1`: a raise rolls
  back the hits already counted in earlier windows of the same call, so a hit that wasn't
  counted is never returned as allowed. Returning `allowed = false` there would leave the
  earlier windows counted.
- **Test the stale path in one session** by planting a row two windows ahead (one window ahead
  can become current if the boundary passes mid-test) and asserting both the refusal and that
  the row's `window_start`/`hits` are unchanged (snapshot it into a temp table first; grant the
  temp table to `service_role` if the asserts run under that role).
- **`set lock_timeout` on the function bounds advisory-lock waits.** Verified locally: with
  another session holding the key's advisory lock, the call failed with `55P03` after 1.0 s
  (`set lock_timeout = '1s'` next to `set search_path = ''`). `create or replace` replaces the
  whole `proconfig`, so restoring an older body also drops the setting.
- **Duplicate array elements:** `p_windows[i] = any (p_windows[1:i - 1])` in the validation loop
  (the slice `[1:0]` is empty, so `i = 1` passes). Check `array_ndims(...) = 1` and
  `array_lower(..., 1) = 1` too instead of relying on NULL elements to reject odd arrays.

Related: [[counter-function-review]], [[pg-cron-in-migrations]], [[atomic-quota-rpc]].
