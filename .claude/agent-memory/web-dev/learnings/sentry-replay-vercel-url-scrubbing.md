---
name: sentry-replay-vercel-url-scrubbing
description: Where Sentry Session Replay and @vercel/analytics/speed-insights put page URLs (incl. #fragments) and which hook scrubs each; beforeSend alone does not cover replay
metadata:
  type: reference
---

**Sentry Replay (v10, replay code lives in `@sentry/replay`) bypasses `beforeSend`** — it only runs for errors. URLs reach a replay through four paths:
- rrweb Meta event (`type 4`, `data.href = location.href`) and Sentry custom events (`type 5`: breadcrumbs + performance spans such as `navigation.push` with `name`=to, `data.previous`=from) → `replayIntegration({ beforeAddRecordingEvent })`.
- Breadcrumbs are copied into the recording via the client's `beforeAddBreadcrumb` hook, which fires *after* the `beforeBreadcrumb` option → `beforeBreadcrumb` cleans both.
- The `replay_event` envelope has `urls[]` (initial URL is built as origin+pathname+**hash**+search) and the http-context `request.url` → no `beforeSend*` option exists; use `Sentry.getClient()?.on('postprocessEvent', fn)` (mutate in place).
- Navigation breadcrumbs use site-relative paths (`/share/a#key=…`), so an http(s)-only fragment stripper misses them — `stripUrlOrPathFragment` in `lib/analyticsPrivacy.ts`.

`BeforeAddRecordingEvent`'s param type has no index signature: a local interface with `[key: string]: unknown` fails tsc.

**@vercel/analytics and @vercel/speed-insights** both read `location.href` themselves but accept `beforeSend(event) => event | null` with a `url` field. The root layout is a server component, so the callback needs a client wrapper (`components/VercelInsights.tsx`) — a function can't cross the server/client prop boundary.

Related: [[consent-regions-and-replay-privacy]].
