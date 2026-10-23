---
name: ai-allowance-and-credit-packs
description: How the webhook prices the managed Pro AI allowance (ai_monthly_credits) and credit packs from money actually paid; Stripe facts behind it (once coupons vanish after the first invoice, customer-level discounts, discount.source.coupon vs coupon, Adaptive Pricing amount fields by API version, which events fire); the shared function used by webhook and re-sync script
metadata:
  type: reference
---

Pro AI has two options on one tier (`pro_ai`): managed and BYOK, told apart by
`subscriptions.ai_mode`, which the webhook derives from the Price (`getPlanForPriceId()` in
`packages/web/lib/tiers.ts`, the one table of all six recurring Prices; it reads env at call time).

**One allowance function.** `subscriptionAiColumns()` in `packages/web/lib/aiAllowance.ts` is used by
the webhook on every subscription write and by `scripts/resync-ai-allowance.ts`
(`lib/aiAllowanceResync.ts`). It uses relative imports only so the script runs under `tsx` without
Next.js. Don't re-derive the math anywhere else; the economics live in `@tabmerger/shared`
(`creditsForPayment`, `monthlyAllowanceForPayment`).

Stripe facts checked against the docs on 2026-10-22:

- `customer.subscription.updated` fires on renewal, on adding a coupon and on plan changes.
  `customer.discount.created/updated/deleted` are documented as customer-coupon events, but their
  Discount object carries `subscription` when the coupon is on a subscription; handled by re-reading
  that subscription (or, for a customer-level discount, the subscription stored on the row of the
  profile holding that customer).
- **A `duration: once` coupon is removed from `subscription.discounts` as soon as the first invoice
  finalizes.** At `checkout.session.completed` the discount is already gone, so pricing only from the
  active discounts gives a 100%-off-first-month code the full allowance. Fix: also cap by the latest
  invoice's charged share (`1 - sum(total_discount_amounts) / subtotal`, currency-agnostic, ignored
  when the subtotal is not positive).
- "When a subscription has no discounts, the customer-level discount, if any, applies." Expand
  `customer` and use `customer.discount` only when the subscription and its item have none.
- Discount's coupon is `source.coupon` on current API versions (an expandable id) and a top-level
  `coupon` object on older ones. **Don't expand `discounts.source.coupon`**: the client is pinned to
  an older version where `source` may not exist, and an invalid expand is a 400 on every event.
  Read either shape and `coupons.retrieve(id)` when it's a string (a deleted coupon 404s → counted as
  100% off).
- Adaptive Pricing: current API versions keep Checkout Session `amount_total`/`currency` in USD and
  put the local amount in `presentment_details`; older versions put the local amount in
  `amount_total` and the USD one in `currency_conversion.amount_total` (`source_currency` usd). The
  event payload follows the endpoint's version, so `usdAmountPaid()` reads both, and returns null
  (pack grants 0, logged) when neither is USD.
- Credit packs grant `creditsForPayment(usdPaid)`, not the line-item quantity (the old
  `listLineItems` call is gone). A 0-credit row is still inserted so redelivery stays idempotent.

Testing: `__tests__/stripeWebhookAiAllowance.test.ts` has a small table mock keyed by
`<table>.<column>` lookups and a `subscription()` / `discount()` builder; use it for new allowance
cases instead of the 2,000-line `stripeWebhook.test.ts`. Asserting `subscriptions.retrieve` calls now
needs a second argument (`expect.anything()` or the expand list).

Related: [[promotion-codes-checkout]], [[webhook-stored-statuses-and-retries]].
