---
name: refund-policy-plan-changes
description: How plan changes follow the no-refund policy (server-scheduled downgrades, upgrades confirmed on Stripe's portal page via a per-target configuration) and the Stripe facts behind it - flow sessions can't be locked, target-only configuration accepted, archived prices rejected, decreasing_item_amount defers monthly→yearly, one price per product+interval, schedule update unsets omitted phase fields
metadata:
  type: reference
---

Policy (docs/PAYMENTS.md "Refund policy", decision 2026-10-23): nothing is refunded; a change
that extends or raises a plan is charged now, prorated, after the customer confirms on Stripe's
portal page; anything lower or shorter waits for the end of the paid period with no credit;
credit packs are never refunded.

Code: `classifyPlanChange()` (lib/tiers.ts) → `planChangeTiming()` (lib/planChangeTiming.ts,
client-safe, shared with the pricing page's confirm dialog: `end_of_period` | `portal_end_of_period`
| `portal`) → `createPlanSwitchSession()` (lib/stripe.ts): `end_of_period` = subscription schedule,
otherwise a `subscription_update_confirm` portal flow whose configuration comes from
`planChangePortalConfiguration()` (one per target Price, found by metadata
`tabmerger_plan_change: v1:<price>`, else created; cached in memory). Our server never changes a
price immediately. Errors carry `code` (`PLAN_SWITCH_ERROR_CODES`, lib/checkoutErrors.ts), and the
client maps them to `pricing.planChange.errors.*`. `__tests__/refundPolicy.test.ts` scans server
code for refunds, credit notes, balance transactions, cancels and `create_prorations`.

Stripe facts (docs.stripe.com and test-mode calls, 2026-10-23; context7 wasn't available):

- **A deep-linked portal session can't be locked to its confirm page.** Flows only hide the
  navigation; `after_completion` only picks where the customer goes after confirming; sessions
  live up to 1 h after last activity. So the session's configuration must list nothing but the
  target Price, or the generic "update plan" page could apply a downgrade at once with a credit.
- **`subscription_update_confirm` doesn't need the current Price in the configuration** (verified
  in test mode: Pro subscription → own-key Price, configuration listing only that Price).
- **An archived Price can't be listed in a portal configuration**: "Only active, per unit licensed
  prices are supported". Archived target prices are now refused up front (`price_unavailable`).
  A switch failing with a generic error after Prices are recreated: check the env price ids first.
- `schedule_at_period_end` condition `decreasing_item_amount` also fires for shorter → longer
  interval when the longer price is cheaper long-term, so it would defer monthly → yearly. Only
  `shortening_interval` is used.
- The portal defers only between prices of **one product**, and can't list **two Prices of one
  product with the same interval**. Hence each plan option is its own product (Pro, Pro AI managed,
  Pro AI own key) and the server schedules every cross-product downgrade.
- A subscription with a schedule can't be updated or cancelled in the portal; release it to unlock.
- Downgrade at period end = `subscriptionSchedules.create({ from_subscription })`, then `update`
  passing back the current phase (items, start/end, discounts, tax rates, metadata: omitted fields
  are **unset**) plus a next phase on the new price. Release the schedule if the update fails.
- Phase `duration` arrived in 2025-07-30.basil (additive, works on the pinned 2025-06-30.basil
  client); `iterations` was removed in 2025-09-30.clover. SDK v22 types have no `iterations`.
- Phase `discounts` left out inherit the customer's discount only, not the subscription's.
- Checkout `custom_text.submit.message`: at most 1,200 characters.
- Portal-config `subscription_cancel.proration_behavior`: `create_prorations` only with
  `mode=immediately`; `always_invoice` errors.
- `billingPortal.configurations.list` has no metadata filter; list (active, non-default, 100) and
  match in code. Configurations can't be deleted, only deactivated.

Testing: probing Stripe test mode from a script needs `createRequire(<packages/web>/package.json)`
to load the SDK, the key read from `.env.local` inside the script (never printed), and the
`sk_test_` prefix checked first. Deactivate probe configurations afterwards.

Related: [[webhook-subscription-id-matching]], [[ai-allowance-and-credit-packs]],
[[promotion-codes-checkout]].
