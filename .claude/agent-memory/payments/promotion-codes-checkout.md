---
name: promotion-codes-checkout
description: How Stripe promotion codes behave on the two hosted checkouts (subscription + AI credit pack), what the webhook may and may not rely on, and the coupon settings that have side effects on plan switches and the Billing Portal
metadata:
  type: project
---

Both Checkout Sessions in `packages/web/lib/stripe.ts` pass `allow_promotion_codes: true`. Codes
live only in the Stripe Dashboard (per mode); nothing in the app applies or validates a discount.
Checked against Stripe's docs on 2026-10-08:

- **No documented incompatibility** with the per-request `2026-03-25.dahlia` version, Adaptive
  Pricing, `adjustable_quantity`, `saved_payment_method_options.payment_method_save` or
  `customer_creation: 'always'`. The dahlia changelog has no entry touching promotion codes.
  A session takes at most one coupon or promotion code.
- **Amounts on the session stay in the integration currency (USD)** even when Adaptive Pricing
  charges the customer in a local currency; the local amount is in `presentment_details`. So
  `amount_total` / `total_details.amount_discount` are safe to read as USD if a future feature
  needs the amount actually paid.
- **Free one-time orders have no PaymentIntent.** A 100%-off code on a `mode: 'payment'` session
  completes with `amount_total: 0`, `payment_intent: null` and no card collected. Fulfil only from
  `checkout.session.completed`, never from PaymentIntent events. The docs don't state which
  `payment_status` such a session reports, so never gate fulfilment on `payment_status === 'paid'`
  alone; `stripeWebhook.test.ts` covers both `paid` and `no_payment_required`.
- **Subscription mode still collects a card at 100% off** (`payment_method_collection` defaults
  to `always`), so renewals charge normally when the coupon's duration ends.
- **Entitlements never depend on money.** Tier comes from the subscription's price ID and status;
  credits come from `listLineItems` quantity. Keep it that way: a discount changes the price only.
- **Idempotency vs. redemption limits are different things.** The unique
  `ai_credit_purchases.stripe_checkout_session_id` stops one session being credited twice. How
  often a code can be redeemed is only what the code's own Stripe settings say. Stripe has no
  "once per customer" limit: the choices are a total redemption limit, an expiry, first-time
  order only, a minimum order value, or a code tied to one customer.
- **Coupons apply to products, not prices.** Monthly and yearly are prices of one product, so a
  coupon can't be limited to one interval. A percent coupon with a multi-month or forever
  duration stays on the subscription and also discounts the prorated charge of a later
  monthly → yearly switch. "Once" is consumed by the first invoice and removed.
- **A coupon with no product restriction works on every checkout**, including the credit pack.
- **The portal's promotion-code setting is separate.** Dashboard "Use promotion codes" is
  `features.subscription_update.default_allowed_updates` containing `promotion_code` in the API;
  "Retention coupons" is the cancel-flow offer. Stripe's default for both is off.
  `createIntervalSwitchSession` passes no `flow_data.subscription_update_confirm.discounts`, so the
  switch itself never adds or removes a discount.
