---
name: prorated-option-switch-review-method
description: Auditing an immediate, prorated switch between two prices of one plan that differ only in a metered allowance (managed AI vs own key): round-trip money math, usage bucket vs billing period, coupon credits
metadata:
  type: reference
---

When a plan option switch applies at once with proration in both directions (`always_invoice`),
and the dearer option carries a monthly allowance:

1. **Round trip, not one leg.** Work out cheap -> dear -> cheap: the charge for the dear leg is
   roughly cancelled by the balance credit for the way back, so the net premium tends to zero.
   Then ask what the dear leg granted meanwhile. If the allowance is written as a full monthly
   figure (not prorated to the charge), the round trip buys the allowance for about nothing.
2. **Which clock resets usage.** Usage keyed by UTC calendar month (`ai_usage.month`) is not
   the billing period. A cap that is *set* (not added) on each switch, against a counter that
   persists for the month, means repeated switches inside one month don't re-grant; one round
   trip per calendar month is the bound. Check both, then quantify per user per month against
   the cost-share rule (`AI_COST_SHARE_PERCENT`) of the cheaper price.
3. **Compare with the previous timing.** Before an "apply now" change, the cheaper leg was often
   deferred to period end; then the exploit only worked near renewal. Say which part is new.
4. **One-off coupons.** A `once` coupon is gone from the subscription after the first invoice,
   so a later proration credit for unused time may be priced at list. A downgrade that credits
   now can turn a free first period into balance. Verify in Stripe test mode, and check whether
   checkout allows promotion codes.
5. **Allowance from a balance-paid invoice.** Customer balance isn't a discount: an invoice paid
   from balance reads as fully charged in `total_discount_amounts`-based checks.

6. **Allowance scaled from the upgrade invoice.** When the upgrade period's allowance is scaled by
   the proration line's span on `latest_invoice`, ask:
   - what else can become `latest_invoice` mid-period. One-off payment checkouts never do.
     Schedule landings carry no proration lines. An interval change charges a full period.
   - whether the period share is granted again in each UTC month the period touches, which
     can double it.
   - whether an unpaid upgrade invoice still earns the share. `total_discount_amounts` ignores
     paid state.
   - whether a coupon that only covers the new product, divided by the *net* subtotal (new line
     minus unused old time), under-grants the allowance.

Related: [[reserve-settle-bound-review-method]], [[refund-after-paid-call-review-method]]
