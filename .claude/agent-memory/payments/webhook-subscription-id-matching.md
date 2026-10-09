---
name: webhook-subscription-id-matching
description: How the Stripe webhook picks the row/user for events after the first purchase, the one-subscription-per-account rule at checkout, the mock shapes their tests need, and Stripe facts checked for them (invoice subscription id location, portal deferral, "limit to one subscription")
metadata:
  type: reference
---

Rules the code follows (see `docs/PAYMENTS.md`, "Which row an event changes" and "One subscription
per account"):

- **The Stripe subscription id is the key after the first purchase.** A cancellation
  (`customer.subscription.deleted`) and a failed payment (`invoice.payment_failed`) update the row
  whose `subscriptions.id` is that id, with no user or profile lookup.
  `customer.subscription.updated` needs a user for the `onConflict: 'user_id'` upsert and resolves
  it in `resolveSubscriptionUserId()`: stored row by subscription id, then `metadata.user_id` (UUID
  shape and an existing profile, only when no row holds the id), then the profile by customer id.
  It returns `{ userId, via }`; a subscription resolved by key 2 or 3 is written only while it is
  entitled. Decision: a later key never overrides an earlier one, and a lookup that fails with a database
  error answers 500 instead of falling through to a weaker key (see
  [[webhook-stored-statuses-and-retries]]).
- **An unmatched event is answered 200 and logged** with the event type and subscription id only
  (`console.warn`, since a declined first payment at checkout produces one routinely).
- **One subscription per account.** `/api/checkout` answers 409 `already_subscribed`
  (`ALREADY_SUBSCRIBED_ERROR` in `packages/web/lib/checkoutErrors.ts`, client-safe) when the
  caller's row is on a paid tier with an entitled status. It runs after the AI-flag 503 and fails
  closed (500) if the row can't be read. `PricingCard` sends a subscriber's plan change to
  `/api/billing-portal` before ever calling checkout; the 409 is the server-side rule behind it.
  The credit-pack checkout is exempt.

Things that are easy to get wrong:

- **Where an invoice's subscription id is depends on the API version of the webhook endpoint**, not
  of the SDK client: `invoice.parent.subscription_details.subscription` on current versions, a
  top-level `invoice.subscription` on older ones (not in the v22 types, so it needs a cast).
  `getInvoiceSubscriptionId()` reads both; keep it that way.
- **Test mocks.** The webhook now calls `.update(...).eq('id', …).select('id')` (the returned rows
  say whether anything matched) and `.maybeSingle()` on lookups. A mock whose `eq` resolves a
  promise, or that only defines `single`, throws inside the handler and the test sees a 500. The
  `mockTables()` helper in `__tests__/stripeWebhook.test.ts` models both tables. Fixture user ids
  like `'user-uuid-1'` are not UUID-shaped, so those tests resolve through the profile key.
- `__tests__/checkout.test.ts` mocks `from()` per table: `profiles` ends in `.single()`,
  `subscriptions` in `.maybeSingle()`. Its default row is `free`/`active`, as after signup.

Stripe facts checked against the docs on 2026-10-08:

- The Billing Portal can defer a plan change to the end of the period only between prices of the
  **same product**. A change between two products (Pro AI to Pro) applies immediately.
- A plain portal session uses the account's **default** configuration. Only
  `createIntervalSwitchSession` passes `STRIPE_PORTAL_CONFIGURATION_ID`.
- Dashboard setting "Limit customers to one subscription" (Settings, Checkout and Payment Links)
  works with API-created Checkout Sessions. Stripe matches on the session's Customer object when
  one is passed, otherwise on the email; it counts active, past_due, unpaid and paused; it needs
  the no-code portal login link enabled.
