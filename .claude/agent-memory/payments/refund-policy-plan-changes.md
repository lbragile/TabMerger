---
name: refund-policy-plan-changes
description: How plan changes follow the no-refund policy (server-scheduled downgrades, upgrades now with always_invoice) and the Stripe portal/schedule facts behind it - decreasing_item_amount defers monthly→yearly, one price per product+interval in the portal, schedule update unsets omitted phase fields, duration vs iterations by API version
metadata:
  type: reference
---

Policy (docs/PAYMENTS.md "Refund policy", decision 2026-10-23): nothing is refunded; a change
that extends or raises a plan is charged now, prorated; anything lower or shorter waits for the
end of the paid period with no credit; credit packs are never refunded.

Code: `classifyPlanChange()` (lib/tiers.ts) → `planChangeTiming()` (lib/planChangeTiming.ts,
client-safe, shared with the pricing page's confirm dialog) → `createPlanSwitchSession()`
(lib/stripe.ts): `end_of_period` = subscription schedule, `now` = `subscriptions.update` with
`always_invoice` + `pending_if_incomplete`, `portal`/`portal_end_of_period` = portal confirm flow.
`__tests__/refundPolicy.test.ts` scans server code for refunds, credit notes, balance
transactions, cancels and `create_prorations`; a new legitimate use has to be argued there.

Stripe facts checked against docs.stripe.com on 2026-10-23 (context7 wasn't available):

- **`schedule_at_period_end` condition `decreasing_item_amount` also fires for shorter → longer
  interval when the longer price is cheaper in the long term.** Every yearly price here is cheaper
  than 12 months, so it would defer monthly → yearly. Only `shortening_interval` is used.
- The portal defers changes only **between prices of one product**; a cross-product change applies
  at once with proration. A portal configuration is direction-blind: any listed product is
  reachable from any other.
- Portal limitation: **no two Prices of the same product with the same interval** in its catalog.
  Managed and own-key Pro AI Prices share a product, so the portal lists managed only and every
  change involving an own-key Price is made by the server.
- A subscription with a schedule attached **can't be updated or cancelled in the portal**. Release
  the schedule (Dashboard or API) to unlock it.
- Portal flows (`flow_data`) hide the rest of the portal's navigation; `after_completion: redirect`
  sends the customer back.
- Downgrade at period end = `subscriptionSchedules.create({ from_subscription })`, then `update`
  passing back the current phase (items, start/end, discounts, tax rates, metadata: omitted fields
  are **unset**) plus a next phase on the new price. Release the schedule if the update fails, or
  the subscription stays locked.
- Phase `duration` arrived in 2025-07-30.basil (additive, works on the pinned 2025-06-30.basil
  client); `iterations` was removed in 2025-09-30.clover. SDK v22 types have no `iterations`.
- Phase `discounts` left out inherit the customer's discount only, not the subscription's.
- Checkout `custom_text.submit.message`: at most 1,200 characters.
- Subscription-cancel config: `proration_behavior` `create_prorations` only works with
  `mode=immediately`; `always_invoice` errors; at period end nothing is prorated anyway.

Related: [[webhook-subscription-id-matching]], [[ai-allowance-and-credit-packs]],
[[promotion-codes-checkout]].
