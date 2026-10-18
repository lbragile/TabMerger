---
name: checkout-funnel-analytics
description: How begin_checkout / checkout_canceled / checkout_abandoned / purchase are wired; GA4 MP facts (dedupe, items); privacy rule (no user_id, random client id, HMAC keyed with STRIPE_WEBHOOK_SECRET); after() in tests
metadata:
  type: reference
---

Checkout-funnel analytics: client half in `packages/web/lib/checkoutAnalytics.ts`, server half in
the Stripe webhook, sent through `sendGa4Event('web', …)` in `packages/web/lib/ga4.ts`. Event names
come from `ANALYTICS_EVENTS` in `packages/shared/src/constants/analyticsEvents.ts`. Setup and the GA4
funnel recipe are in `docs/ANALYTICS.md`.

- **`checkout.session.expired` is analytics-only.** No DB read or write and no Stripe call, so it
  can't fail into a 500, and a redelivery changes nothing but a duplicate GA event (identifiable by
  `checkout_session_id`). Stripe only sends it if the endpoint subscribes to it, in test and live
  mode separately.
- **Tier/interval for an expired session come from session metadata** (`tier`, `interval`), which
  `createCheckoutSession` stamps from route-validated values. Only on the session, not
  `subscription_data`. The webhook re-validates them against `CHECKOUT_TIERS`/`CHECKOUT_INTERVALS`
  and never uses them for billing: the subscription tier still comes from the price id.
- **GA4 deduplicates only `purchase`, by `transaction_id`.** `checkout_completed` and
  `checkout_abandoned` double-count on a Stripe redelivery; count unique `checkout_session_id`.
- **Privacy rule: GA data is never linked to an account or a browser session** (the privacy page
  promises it). No `user_id` (`sendGa4Event` has no option for one); every server event gets a
  fresh random `client_id`; no `_ga` cookie is read or stored in session metadata. Security review
  blocked both a hashed-account id and a stored `_ga` id. Consequence: the funnel is read as
  event counts, not a user-level funnel.
- **Stripe session ids go to GA only as HMAC-SHA256 keyed with `STRIPE_WEBHOOK_SECRET`**, not
  `GA_API_SECRET`: Google receives `GA_API_SECRET` in the MP query string, so it can't be the key.
  Rotating the webhook secret changes ids from then on.
- **Webhook GA events run in `after()`** (next/server) with a 2s `AbortSignal.timeout` in ga4.ts.
  `after()` throws outside a request scope, so route tests `vi.mock('next/server')` with the
  actual module plus an `after` that queues callbacks, then flush them (see the webhook tests).
- **cancel_url locale** comes from the Referer's first path segment, else the `NEXT_LOCALE`
  cookie, each checked with `isAppLocale`, then `localizedPath`.
- **`cancel_url` marker:** `/pricing?checkout=canceled&tier=&interval=`. `CheckoutCanceledTracker`
  fires once (a ref guard survives StrictMode's double effect), then `router.replace` strips the
  params using `next/navigation`'s `usePathname` (keeps the locale prefix). The next-intl router's
  pathname would drop it.
- `begin_checkout` fires before the `/api/checkout` response, so signed-out clicks (which then 401
  to sign-in) count too.
