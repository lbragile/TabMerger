---
name: realtime-updated-at-not-bumped
description: groups realtime UPDATE events can carry an old updated_at (position-only / view_count updates); SyncIndicator uses event arrival time and never moves backwards
metadata:
  type: reference
---

Position-only and view_count updates on `groups` keep `updated_at` unchanged, but still emit realtime UPDATE events. Do not treat `payload.new.updated_at` as "when the sync happened". `SyncIndicator` takes the max of arrival time, `updated_at`, and the current value (`latestOf`). The initial `order by updated_at` fetch ignores reorders, which is accepted.

Testing: the "Syncing..." pulse lasts 2s, so assert the settled label with `waitFor(..., { timeout: 3000 })`.
