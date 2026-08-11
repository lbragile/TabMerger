---
name: verify-sync
description: Confirm whether extension changes have actually reached Supabase, instead of guessing from source or repeating manual query round-trips.
disable-model-invocation: true
---

# Verify sync

TabMerger's extension is local-first — a fix landing in code does not mean it has synced.
Every propagation gap this project has hit follows the same shape: the extension needs a
rebuild/reload, then a real user action (open popup, tab change, unlock) before Supabase
reflects anything. Re-deriving that from scratch each time wastes turns. This skill runs
the check once and reports a clear before/after.

## Steps

1. Ask the user (if not already stated) which table/row is in question — `groups`,
   `sessions`, `device_sessions`, or `shared_bundles` — and which account (email or user id).
2. Query current state via `mcp__supabase__execute_sql` against project `xmofzeqcuyenmxgxjtrv`:
   - `groups`: `select id, name, updated_at, jsonb_typeof(windows), windows->>'v' from groups where user_id = '<id>' order by updated_at desc;`
   - `sessions`: same shape on `groups` column.
   - `device_sessions`: same shape on `now_open_snapshot`.
   - `shared_bundles`: same shape on `groups_snapshot`, plus `created_at` (public links never self-heal — see CLAUDE.md's E2E encryption notes if the row predates a fix).
3. Report the row count, most recent `updated_at`/`created_at`, and whether the content
   column is plaintext (`array`/`string`) or encrypted (`{v:1,...}`).
4. If the data looks stale relative to what the user expects, tell them plainly what has
   to happen next — reload the extension, then trigger the specific action that pushes
   this table (popup open for groups, saving a session, any tab change for device
   sessions, creating a new share for shared_bundles) — rather than re-running the same
   query hoping it changes on its own.
5. If asked, re-run the same query after the user confirms they've done that, and report
   the diff directly (what changed, what didn't).

Do not speculate about *why* something hasn't synced beyond what the query shows — if the
row is genuinely unchanged, say so and point at the two most common causes (not rebuilt/
reloaded yet, or encryption locked so the push was skipped) rather than inventing a new
theory each time.
