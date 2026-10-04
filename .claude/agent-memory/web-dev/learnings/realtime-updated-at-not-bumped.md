---
name: realtime-updated-at-not-bumped
description: Realtime rules for the web app - subscribe only after the realtime client holds the user's token (subscribeWithUserToken), which groups events reach a user-filtered subscription, why payload.new.updated_at can be old
metadata:
  type: reference
---

## Rule: token first, then subscribe

Every channel in the web app is opened through `subscribeWithUserToken` (`lib/supabase/realtimeAuth.ts`): `auth.getSession()` -> `realtime.setAuth(token)` -> `channel(...).on(...)` -> `subscribe()`. Never call `.channel().subscribe()` directly in an effect.

Why (realtime-js 2.110 source): `RealtimeChannel.subscribe()` copies `socket.accessTokenValue` into the join payload synchronously. A browser client created in the same tick has not read its session from the cookies yet, so the join carries no token. The server still answers ok / SUBSCRIBED, and RLS then filters out every `postgres_changes` event. A status of SUBSCRIBED is therefore not proof that events will arrive.

Other facts from the source:
- Token refresh needs nothing extra: supabase-js `_handleTokenChanged` calls `realtime.setAuth(newToken)` on TOKEN_REFRESHED, and `_performAuth` pushes an `access_token` frame to every joined channel. This relies on the shared browser client (`createBrowserClient` is a singleton per page).
- `realtime.channel(topic)` returns the existing channel object for a topic that is still being removed, and `subscribe()` on a channel that is not closed joins nothing. The helper waits for a pending removal of the same topic.
- The helper's cleanup works before the async setup finished (nothing is created), which keeps the development double mount to one channel.
- CHANNEL_ERROR / TIMED_OUT / CLOSED are logged once per subscription with `console.warn`.

Tests: a Supabase client mock for anything mounting `SyncIndicator` needs `auth.getSession` and `realtime.setAuth` besides `auth.onAuthStateChange`, `channel` and `removeChannel`. Record call order in an array to assert `getSession, setAuth, channel, subscribe`.

Node check against the local stack: `createBrowserClient(url, key, { cookies: { getAll, setAll }, isSingleton: false })` with an in-memory cookie jar reproduces a page that only has a persisted session.

## Which `groups` events arrive (user-filtered subscription, measured 2026-10-03)

- INSERT: delivered, full row.
- Content UPDATE: delivered, full `new`, `old` holds only `id`, `updated_at` is new.
- Position-only UPDATE: delivered, but `updated_at` is unchanged (also true for view_count). Do not treat `payload.new.updated_at` as "when the sync happened".
- DELETE: not delivered. Replica identity is the primary key, so the deleted row carries no `user_id` for the filter to match (Supabase documents DELETE events as not filterable).

`SyncIndicator` therefore takes the newest of: event arrival time, `updated_at`, a completed manual sync reported by the extension (this is what covers deletes and syncs that changed no row), the time remembered in localStorage, and the value on screen (`recordSync` + `latestOf`, never backwards).

See [[sync-indicator-status-model]] for the status model and test patterns.
