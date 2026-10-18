---
name: learnings-analytics-privacy-crosscheck
description: When webhook/checkout code sends analytics (GA4 Measurement Protocol, PostHog), cross-check identifiers against the privacy page's Analytics section
metadata:
  type: reference
---

Server-side analytics sent from the Stripe webhook (`sendGa4Event` in `packages/web/lib/ga4.ts`) bypass the browser, so any identifier added there (GA4 `user_id`, `client_id`, Stripe session ids as `transaction_id`) must be checked against the "Analytics" section of `packages/web/app/[locale]/(marketing)/privacy/page.tsx` and its third-party table, which describe GA data as anonymous / not linked to accounts.

**How to apply:** for any payments change that touches `sendGa4Event` callers, grep the privacy page for "Analytics" and compare wording to what is actually sent. A SHA-256 of a Supabase UUID is pseudonymous (stable, joinable), not anonymous. A GA client id stored in Stripe session metadata next to `user_id` is itself an account link on our side. `GA_API_SECRET` is sent to Google in every Measurement Protocol URL, so it is not a good HMAC key for ids meant to be opaque to Google. Also check `sendGa4Event` callers inside the webhook have a bounded fetch time, since the webhook awaits them before answering Stripe.
