---
name: position-only-updated-at
description: groups trigger (020) keeps updated_at on position-only updates; server always stamps now() otherwise, client updated_at ignored
metadata:
  type: reference
---

Migration 020 adds `groups_set_updated_at()` (invoker, `search_path=''`) used only by `groups`; `update_updated_at()` stays for `subscriptions`.
- Compares `to_jsonb(new) - 'position' - 'updated_at'` vs old; equal means keep `old.updated_at`. New columns are covered automatically.
- Client-supplied `updated_at` is ignored on every update (server clock is the LWW authority, avoids forged recency).
- Upserts with `on conflict do update` also run this trigger, so an upsert that changes nothing but position keeps the stamp too.
- Docker/local Supabase may be down; a scratch `initdb` Postgres on another port is enough to test pure trigger logic (pgTAP file in supabase/tests still needs `supabase test db`).
- `view_count` is excluded too (007's increment_group_view_count would otherwise stamp every share view); fast path stamps now() when position and view_count are unchanged.
- pgTAP: now() is constant per transaction, so assert bumps with `is(updated_at, now())`; restore a sentinel stamp between cases with `set local session_replication_role = replica` (disables triggers; test runner is superuser). An identical no-op update is still stamped (same as the old trigger).
