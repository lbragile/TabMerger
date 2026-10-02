---
name: server-side-secret-proxy
description: Default pattern for any extension call to a third-party API needing a secret — proxy through packages/web, never embed client-side
metadata:
  type: feedback
---

When the extension needs to call a third-party API that requires a secret (API key, signing secret, etc.), always route it through a server-side proxy route in `packages/web/app/api/*` rather than embedding the secret in the extension bundle — this is the correct default for this project, not a case-by-case risk judgment.

**Why:** Anything under `VITE_*` ships in the unzipped extension bundle and is trivially extractable. GA4 Measurement Protocol's `api_secret` is a real secret (server-only by design) — it was previously embedded client-side in `analytics.ts` and fetched directly to `google-analytics.com/mp/collect`, exposing the secret to anyone who unzipped the extension. Fixed by adding `packages/web/app/api/track/route.ts` (web-dev's side) and pointing `trackEvent()` at `${VITE_WEB_APP_URL}/api/track` instead, forwarding `{ event, params, client_id }`.

**How to apply:**
- Not every client-embedded key is a violation — check whether the third party designed the key to be public. PostHog project API keys (`VITE_POSTHOG_API_KEY`) are explicitly meant to be client-exposed (like a Stripe *publishable* key), so `trackPostHogEvent()` in `analytics.ts` correctly still calls PostHog's HTTP Capture API directly — do not "fix" that path by proxying it too.
- `getClientId()` stays in the extension either way — client identity is local state (`chrome.storage.local`), not a secret; only the third-party auth credential needs to move server-side.
- When adding a new proxy route, give both the extension-dev and web-dev agents the same request/response contract up front so they can build in parallel without blocking on each other.
