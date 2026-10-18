---
name: server-side-ga4-events
description: lib/ga4.ts sendGa4Event for server-side GA4 Measurement Protocol events; once-per-view guard for page-triggered events; cron bearer pattern; page.tsx export trap
metadata:
  type: reference
---

- All server-side GA4 events go through `sendGa4Event('web' | 'extension', {...})` in
  `packages/web/lib/ga4.ts` (two properties: web = `NEXT_PUBLIC_GA_MEASUREMENT_ID`+`GA_API_SECRET`,
  extension = `GA_EXTENSION_*`). Event names come from `ANALYTICS_EVENTS` in `@tabmerger/shared`.
- GA4 does NOT deduplicate Measurement Protocol events. A "fire when this page loads" event needs
  its own guard: a client component calls a server action from an effect, guarded by a ref
  (StrictMode double effect) + a sessionStorage key scoped to `location.search` (refresh). See
  `components/uninstall/UninstallTracker.tsx`. Server actions are public endpoints: re-validate
  every argument server-side.
- Firing from the server component render instead would count prefetches and link-preview bots.
- Uninstall URL consent flag `a=1|0` (`UNINSTALL_SURVEY_PARAMS.analytics`); without a flag only
  chrome/edge count (`uninstallAnalyticsAllowed`).
- Vercel cron routes: compare `Authorization` to `Bearer ${CRON_SECRET}` with `timingSafeEqual`
  after a length check, and fail closed (401) when `CRON_SECRET` is unset. Hobby plans only allow
  daily schedules (an hourly expression fails the deploy).
- Never `export` a helper const from a `page.tsx`: Next's generated route types reject unknown
  page exports. Keep it module-private or move it to `lib/`.
- [[cloud-sync-gating-helper]] uses the same "server enforces, client explains" split.
