---
name: checkout-stripe-guard
description: How /api/checkout asks Stripe before selling (lib/checkoutGuard.ts) - live/open/failed/missing-customer outcomes, the upward row write via the webhook's upsert, expiring a customer's other open subscription checkouts, Stripe test-mode facts (sessions list by customer + expire on basil, expire of a non-open session is 400 with no code), and the test setup
metadata:
  type: reference
---

Rules (docs/PAYMENTS.md "One subscription per account"):

- Order in the route: auth → body → AI flags (503 `ai_disabled`, before any Stripe call) → row
  (paid + entitled → 409 `already_subscribed`, `recorded: true`) → price id → profile → Stripe
  check only when the profile has a `stripe_customer_id` → create session.
- `checkStripeBeforeCheckout()` lists the customer's non-canceled subscriptions
  (`listCustomerSubscriptions()` in lib/stripe.ts: 100 per page, `starting_after`, max 5 pages,
  more throws) and returns `live` (any entitled status, any price) / `open`
  (`OPEN_SUBSCRIPTION_STATUSES`) / `check_failed` / `customer_missing` / `clear`.
- `live` → 409 `already_subscribed` with `recorded`. The row is written upward only through
  `recordLiveSubscription()` (lib/subscriptionSync.ts): retrieve by id (expanded for the AI
  allowance), same customer, still entitled, a single known price, metadata user absent or equal,
  then `upsertSubscription()` — the exact write `checkout.session.completed` and
  `customer.subscription.updated` make. A failed write still refuses (`recorded: false`).
- `customer_missing` → the id is dropped and Checkout uses `customer_email` (creates a customer);
  the completed webhook writes the new id to the profile. Decision: refusing would lock the account
  out (profiles are server-managed), and no subscription can exist on a customer Stripe lacks.
  Only on page 1 and only with `param === 'customer'`: `listCustomerSubscriptions()` rewraps any
  later-page error as a plain Error (no code), because a customer deleted between pages also
  answers `resource_missing` / param `customer`, and a bad cursor answers `resource_missing` /
  param `starting_after` (both checked in test mode 2026-10-24).
- A profile read error other than PGRST116 is 503 `billing_check_failed`: read as "no customer" it
  would skip the Stripe check and sell on a new customer.
- `recordLiveSubscription()` reads the subscription again after the upsert; if it ended meanwhile
  (a `deleted` event that matched no row because the row still had its `free_` id) it writes the
  row back down by id, like `resyncEndedSubscription()`.
- Client: `recorded: true` → toast `alreadySubscribedShown` + `router.refresh()`; `recorded`
  false/absent → the old toast + billing portal. `pay_or_resume` → the switch's copy;
  anything else without a URL → `checkoutFailed`.
- After `checkout.sessions.create` (subscription mode, with a customer),
  `expireOtherOpenSubscriptionCheckouts()` lists `{ customer, status: 'open' }` and expires every
  other `mode === 'subscription'` session. Created first, then expired, so a racing tab can't be the
  one that survives. A failed expire re-reads that session: `complete` + `subscription` means a
  plan went live meanwhile, so the new session is expired too and `CheckoutRaceLostError`
  (lib/checkoutErrors.ts, kept there so tests that mock lib/stripe.ts still have the class) makes
  the route answer 409 `already_subscribed`, `recorded: false`, no URL. Anything else: logged,
  checkout goes ahead.

Stripe facts (test mode, 2026-10-24, client pinned to 2025-06-30.basil, sessions created with
2026-03-25.dahlia):

- `checkout.sessions.list({ customer, status: 'open' })` returns the customer's open sessions;
  `checkout.sessions.expire(id)` answers the session with `status: 'expired'`.
- Expiring a session that is no longer open throws `StripeInvalidRequestError`, HTTP 400,
  **no `code`** — match on nothing but "it failed" and move on.

Moved code: `upsertSubscription()` and the webhook's AI-column helper now live in
lib/subscriptionSync.ts (`logLabel` gives `Stripe webhook: <event>`, `Plan switch resync:` or
`Checkout resync:`); `describeStripeError()` moved to lib/stripeErrors.ts so lib/stripe.ts can use
it without importing lib/planSwitch.ts.

Tests: `__tests__/checkoutStripeGuard.test.ts` runs the real route with a mocked `stripe` class
(subscriptions list/retrieve, checkout sessions create/list/expire, coupons) and an in-memory row
whose service-role `upsert` applies the values. `__tests__/checkout.test.ts` mocks
`@/lib/checkoutGuard` (`mockCheckStripe`, default `{ kind: 'clear' }`); any route test that gives
the profile a customer id and doesn't mock the guard must mock the SDK's `subscriptions.list` and
`checkout.sessions.list`.

Related: [[plan-switch-ended-plan-resync]], [[webhook-stored-statuses-and-retries]],
[[webhook-subscription-id-matching]].
