---
name: feedback-gtag-environment-tagging
description: trackEvent() appends an `environment` field to every GA4 call — tests asserting exact gtag params must include it, or waitFor() hangs to timeout with no assertion error
metadata:
  type: feedback
---

`lib/analytics.ts`'s `trackEvent(name, params)` always merges in
`environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development'` before calling
`window.gtag('event', name, ...)`. This was added intentionally in commit `c454269`
("Tag Sentry/GA/PostHog events with environment for shared dev/prod properties") —
it is not a bug, it's how dev and prod share one GA4/PostHog/Sentry property.

**Why this bit us:** three pre-existing tests (`signUpAnalytics.test.tsx`,
`SetPasswordForm.test.tsx`) asserted `toHaveBeenCalledWith('event', name, { method: '...' })`
or `..., undefined)` — the exact params shape from *before* the environment tagging was
added. Because `toHaveBeenCalledWith` never matched, `waitFor()` polled until its default
5000ms timeout with no assertion-failure message — it looked like the event silently
stopped firing, when actually `gtag` was called every time, just with an extra key.
Symptom is indistinguishable at a glance from "event genuinely never fires" — always
diff the actual mock.calls against the expected object before assuming a hang means a
real regression.

**How to apply:** whenever writing/reviewing a test that asserts an exact `gtag`/`trackEvent`
call payload in `packages/web`, include `environment: 'development'` in the expected object
(test env has no `NEXT_PUBLIC_VERCEL_ENV` set, so it always falls back to `'development'`).
Same applies to any other `posthog.register`/Sentry call sites that read
`NEXT_PUBLIC_VERCEL_ENV` (see `components/posthog-provider.tsx`, `instrumentation-client.ts`)
if tests ever assert those exactly instead of with `expect.objectContaining`.
