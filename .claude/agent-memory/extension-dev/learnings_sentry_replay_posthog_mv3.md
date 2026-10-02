---
name: sentry-replay-posthog-mv3
description: Sentry Session Replay and PostHog viability under the extension popup's MV3 CSP and few-second lifetime
metadata:
  type: project
---

Added Sentry Replay to the popup and PostHog via HTTP Capture API (no JS SDK). Key findings:

- **Sentry Replay works in the popup, not the background service worker.** `replayIntegration()` needs a real `document`/DOM, which the popup has (unlike `background.ts`'s service worker, which already disables `defaultIntegrations` for this exact reason). Added it only to `src/entrypoints/popup/main.tsx`'s existing `Sentry.init`, matching web app's sampling (`replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`). It's bundled via npm (no remote script), so it's not blocked by the MV3 `script-src 'self'` popup CSP.
- **Caveat to keep stating:** the popup typically lives only a few seconds (closes on blur), so a "session" replay is realistically just the on-error tail, not a real session recording. Don't oversell this — it's useful for crash context, not UX research.
- **`posthog-js` (the standard SDK) is not viable under MV3 popup CSP.** Its optional extensions (toolbar, exception autocapture, session-replay recorder) lazy-load additional `<script>` tags from PostHog's CDN at runtime — blocked by `script-src 'self'`. This is the same constraint that forced GA4 onto the Measurement Protocol instead of `gtag.js` (see `src/lib/analytics.ts`'s pre-existing `trackEvent`). Implemented `trackPostHogEvent` in `analytics.ts` as a direct `fetch` POST to `${VITE_POSTHOG_HOST}/capture/` — no SDK, no replay. `trackEvent` now also calls `trackPostHogEvent` so every existing GA4 call site gets mirrored to PostHog for free.
- PostHog session replay specifically requires the JS SDK's DOM recorder — there is no HTTP-API equivalent. Under MV3 CSP it's flatly not available here, full stop (not a sampling/config tradeoff like Sentry Replay).
- Env pattern: added `VITE_POSTHOG_API_KEY`/`VITE_POSTHOG_HOST` to `env.d.ts`'s `ImportMetaEnv` and `.env.example`, same no-op-when-unset convention as GA4.
