---
name: encrypt-status
description: One-shot snapshot of plaintext vs encrypted row counts across all four E2E-encrypted tables (groups, sessions, device_sessions, shared_bundles) for a given account.
disable-model-invocation: true
---

# Encrypt status

Broader sibling of `verify-sync` — reports all four encrypted tables at once instead of
one at a time, for a single account.

## Steps

1. Get the account's user id (ask for email if not given, resolve via
   `select id, email from auth.users where email = '<email>';` against project
   `xmofzeqcuyenmxgxjtrv`).
2. Run one combined query:

```sql
select 'groups' as tbl,
  count(*) filter (where jsonb_typeof(windows) = 'array') as plaintext,
  count(*) filter (where windows->>'v' = '1') as encrypted
from groups where user_id = '<id>'
union all
select 'sessions',
  count(*) filter (where jsonb_typeof(groups) = 'array'),
  count(*) filter (where groups->>'v' = '1')
from sessions where user_id = '<id>'
union all
select 'device_sessions',
  count(*) filter (where jsonb_typeof(now_open_snapshot) = 'object' and now_open_snapshot ? 'windows'),
  count(*) filter (where now_open_snapshot->>'v' = '1')
from device_sessions where user_id = '<id>'
union all
select 'shared_bundles',
  count(*) filter (where jsonb_typeof(groups_snapshot) = 'array'),
  count(*) filter (where groups_snapshot->>'v' = '1')
from shared_bundles where user_id = '<id>';
```

3. Also check whether an `encryption_keys` row exists for this user (`select user_id from
   encryption_keys where user_id = '<id>';`) — if it doesn't, every plaintext row above is
   expected and nothing is broken; encryption hasn't been set up yet for this account.
4. Report as a small table: table name, plaintext count, encrypted count, and one line of
   context per row if there's a mismatch worth explaining — `sessions`/`device_sessions`
   self-heal automatically on next extension activity, `shared_bundles` plaintext rows
   older than any encryption fix cannot self-heal (see `reencrypt-legacy-share` skill),
   `groups` should always be fully encrypted once `encryption_keys` exists — a lingering
   plaintext `groups` row alongside an existing key row is worth investigating, not normal.
