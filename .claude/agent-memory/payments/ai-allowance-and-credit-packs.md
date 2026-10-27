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

**Upgrade into managed mid-period** (2026-10-26): allowance x share, share = span of the positive
proration line for the current price on a `subscription_update` latest invoice, in months of the
price's period, capped at 1 (`upgradePeriodShare()`). Basil invoice lines: proration is
`line.parent.subscription_item_details.proration`, price is `line.pricing.price_details.price`
(older: `line.proration`, `line.price`). Deterministic from invoice + period, so redeliveries and
later updates in the period keep it; the `subscription_cycle` renewal restores the full figure.
Test clock (31-day period): 15 days left → 1,209, 1 day → 80. Scaling the money instead
(`creditsForPayment` of the remaining-time line) fails for short spans: the $0.30 fixed fee eats it.

**Failed upgrade payment through the portal = pending update** (test clock + `pm_card_chargeCustomerFail`,
2026-10-26): the confirm page shows "We couldn't process your payment" and the subscription keeps
the OLD price, stays `active`, gets `pending_update` (expires ~23 h); latest_invoice is the open
`subscription_update` invoice whose positive line is the NEW price. Paying it fires
`customer.subscription.pending_update_applied` + `customer.subscription.updated` (invoice paid);
unpaid it expires and the invoice goes `void` (still latest_invoice). So never zero the allowance
just because the latest `subscription_update` invoice is unpaid: a paid managed monthly sub with a
failed monthly → yearly attempt would lose its allowance. `upgradePeriodShare()` returns 0 only when
the unpaid invoice has a positive *proration* line for the *current* price (price moved without
payment: Dashboard/API only). Full-price lines (landings, monthly → yearly) follow the renewal rule.

**Discounts on proration lines (basil)**: Stripe bakes the coupon into the proration line's
`amount` (15-day managed line 387 → 310 with 20% off) and reports `discount_amounts: [{amount: 0}]`
and `total_discount_amounts: [0]`; a product-restricted coupon simply isn't applied to the other
product's credit line. Non-proration lines keep `amount` pre-discount with the discount in
`discount_amounts`. `latestInvoiceChargedShare()` reads an upgrade invoice's current-price line,
not the net subtotal.

**Flags per option.** Decision (2026-10-22): the own-key option can launch before managed AI.
Payment routes gate with `aiAvailability(NEXT_PUBLIC_AI_ENABLED, NEXT_PUBLIC_AI_BYOK_ENABLED)` read on
every call: Pro AI checkout and plan switches need the flag of the option bought or kept
(`[aiMode]`, including an interval-only switch); credit packs need `managed`; Pro never depends on
either. Tests must stub both env vars, or a shell value of the BYOK flag can flip 503 tests.

Related: [[promotion-codes-checkout]], [[webhook-stored-statuses-and-retries]].
