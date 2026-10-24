---
name: plan-switch-ended-plan-resync
description: How the plan switch corrects a row that still shows a plan Stripe has ended (missed webhook) and hands the user to checkout; the "no entitled sub at all" vs "live sub on unknown price" split; Stripe list/resource_missing facts checked in test mode; why the write is keyed on the subscription id; React-compiler lint gotcha in usePlanChange
metadata:
  type: reference
---

Rules the code follows (docs/PAYMENTS.md "Plan changes and timing", the paragraph after "Errors"):

- `createPlanSwitchSession()` (lib/stripe.ts) throws `PlanSwitchError` with three "can't find it"
  reasons: `no_customer` (list threw `resource_missing`), `no_entitled_subscription` (no entitled
  subscription in the list AND `has_more !== true`), `no_subscription` (an entitled one exists but
  isn't on the plan's prices, has several items, or the list has more pages). Only the middle one
  may correct anything: a live subscription on an unknown price must never read as "ended".
- `startPlanSwitch()` (lib/planSwitch.ts): `no_customer` → 400 `no_billing_account` (logged without
  the customer id); `no_entitled_subscription` → `correctEndedPlan()` → `resyncEndedSubscription()`
  (lib/subscriptionSync.ts). Corrected → one `console.warn` line + 403 `no_paid_plan` with
  `checkout: { tier, interval, aiMode? }` (type + client parser `parsePlanSwitchCheckoutTarget` in
  lib/checkoutErrors.ts). Not corrected → plain 403. Failed read/write → 500 `switch_failed`.
- Old clients still work: they see the 403 `no_paid_plan` message, which is true after the write.
- `usePlanChange` posts `checkout` to `/api/checkout` (`subscribeInstead()`); on failure it shows
  the `no_paid_plan` message (or `aiDisabled`) and calls `router.refresh()`. No new copy needed.

Decisions and why:

- **The correction write is keyed on the row's subscription id** (`updateSubscriptionById`, the
  `deleted` handler's write), not the webhook's user-keyed upsert (`syncSubscription`). A checkout
  completing between the Stripe read and the write moves the row to a new subscription id; an
  upsert on `user_id` would overwrite the new live plan with the old canceled one.
- **Written only when** the retrieved subscription's customer equals the profile's customer and its
  status is not entitled. So this path can only end or lower a row, never grant.
- **Stripe has no subscription with the row's id → nothing written.** Same as the webhook: a key
  for the wrong account or mode makes every lookup `resource_missing`, and must not end real plans.
- A row with no Stripe id (`free_` signup prefix) is never sent to Stripe.

Stripe facts (test mode, 2026-10-24):

- `subscriptions.list({ customer })` with no `status` leaves out canceled subscriptions (a
  canceled-only customer lists `[]`); `status: 'all'` includes them.
- `subscriptions.list` for an unknown customer throws `StripeInvalidRequestError`, code
  `resource_missing`, **HTTP 400** (a retrieve of a missing object is 404). Match on `code` only.

Gotchas:

- In `usePlanChange.tsx`, calling a helper declared *after* `send()` made the React-compiler lint
  (`react-hooks/immutability`) flag the existing `window.location.href = ...` line in `send()`.
  Declaring the helper above `send()` fixed it.
- Tests: `__tests__/planSwitchDriftResync.test.ts` runs the real switch and checkout routes with a
  mocked `stripe` SDK class and an in-memory row whose `.update().eq('id').select()` only changes
  the row stored under that id; it covers correction + response, checkout after it, no downgrade
  on an unknown price (checkout still 409), `has_more`, resource_missing, and the race.

Related: [[webhook-stored-statuses-and-retries]], [[refund-policy-plan-changes]],
[[webhook-subscription-id-matching]].
