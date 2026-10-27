---
name: refund-policy-plan-changes
description: How plan changes follow the no-refund/no-credit policy (portal-deferred downgrades via the v2 per-target configuration, server-scheduled shorter+other changes, upgrades charged on Stripe's confirm page, the log-only plan-change alarm) and the Stripe facts behind it - flow sessions can't be locked, target-only configuration accepted, archived prices rejected, one price per product+interval, schedule update unsets omitted phase fields
metadata:
  type: reference
---

Policy (docs/PAYMENTS.md "Refund policy", decisions 2026-10-23 and 2026-10-26): nothing is
refunded and no plan change leaves a credit; a change that extends or raises a plan is charged now,
prorated (unused old time netted against the new charge), after the customer confirms on Stripe's
portal page; anything lower or shorter waits for the end of the paid period; credit packs are never
refunded.

Code: `classifyPlanChange()` (lib/tiers.ts, says what a change is) → `planChangeTiming()` (lib/planChangeTiming.ts, says when and who defers it,
client-safe, shared with `usePlanChange`, see [[plan-change-client-confirmation]]: `portal` = upgrade; `portal_end_of_period`
= yearly→monthly on one plan, or a downgrade whose interval doesn't shorten (the confirm page
defers it); `end_of_period` = shorter interval + another change, or an unknown price (server
schedule)) → `createPlanSwitchSession()` (lib/stripe.ts): `end_of_period` = subscription schedule,
otherwise a `subscription_update_confirm` portal flow whose configuration comes from
`planChangePortalConfiguration()` (one per target Price, found by metadata
`tabmerger_plan_change: v3:<price>` among active configs, else created; cached in memory; v2 added
conditions `decreasing_item_amount` + `shortening_interval`; v3 sets `default_allowed_updates:
['price']`, which removes "Add promo code" from the confirm page, verified in test mode 2026-10-26). The webhook's log-only
`planChangeAlarms()` (lib/planChangeAlarm.ts) watches for the policy breaking; see
[[plan-change-alarm]]. Our server never changes a
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
- `schedule_at_period_end` condition `decreasing_item_amount`: rechecked 2026-10-26 on the real
  confirm page ([[portal-deferral-matrix]]). Within one product it never deferred monthly → yearly
  (the old note that it would was wrong); across products it deferred monthly → yearly only when
  the plan also went down (Pro AI monthly → Pro yearly). It never held back an upgrade.
- Stripe's docs say the portal defers only between prices of **one product**, and it can't list
  **two Prices of one product with the same interval**. Hence each plan option is its own product
  (Pro, Pro AI managed, Pro AI own key). Doc line (configure-portal
  page, "Manage downgrades", rechecked 2026-10-26): "You can only downgrade at the end of a billing
  period between prices that have the same product." `schedule_at_period_end.conditions` are only
  `decreasing_item_amount` and `shortening_interval`. In test mode on 2026-10-26,
  `decreasing_item_amount` did defer cross-product downgrades even though the docs say it can't,
  and `shortening_interval` didn't ([[portal-deferral-matrix]]).
- Superseded the same day: a v1 decision applied managed → own key at once through the portal
  (cross-product, `shortening_interval` only, `always_invoice`): $7.99 → $5.99 at period start
  made a -$2.00 invoice, `status: paid`, customer `balance` -200. Under v2 that switch is deferred
  instead. Kept as the measured fact: a cheaper immediate switch with `always_invoice` becomes a
  balance credit, never a refund or credit note.
- A subscription with a schedule can't be updated or cancelled in the portal; release it to unlock.
- Downgrade at period end = `subscriptionSchedules.create({ from_subscription })`, then `update`
  passing back the current phase (items, start/end, discounts, tax rates, metadata: omitted fields
  are **unset**) plus a next phase on the new price. Release the schedule if the update fails.
- Phase `duration` arrived in 2025-07-30.basil (additive, works on the pinned 2025-06-30.basil
  client); `iterations` was removed in 2025-09-30.clover. SDK v22 types have no `iterations`.
- Phase `discounts` left out inherit the customer's discount only, not the subscription's. The server
  schedule's last phase passes `{ discount: 'di_…' }` for subscription discounts whose coupon applies
  to the target product (`coupons.retrieve(id, { expand: ['applies_to'] })`: applies_to is only
  returned when expanded); referencing the same `di_` in two phases works.
- Server schedule last phase = `end_date: periodEnd + 1` (like the portal's), not `duration`: lands
  with one `subscription_update` invoice of the new price, no proration lines, releases 1 s later,
  next renewal normal; the landing update's event object still has `schedule` (alarm quiet).
  Verified with a test clock 2026-10-26.
- Upgrades (`portal` timing) are previewed first: `invoices.createPreview({ customer, subscription,
  subscription_details: { items: [{ id, price }], proration_behavior: 'always_invoice' } })`; total
  < 0 → `would_credit` → 409 `switch_needs_support`; preview error → rethrown → 500 `switch_failed`.
  Not run for deferred changes (it would preview an immediate change). Preview `total` excludes
  the customer's existing balance.
- Checkout `custom_text.submit.message`: at most 1,200 characters.
- Portal-config `subscription_cancel.proration_behavior`: `create_prorations` only with
  `mode=immediately`; `always_invoice` errors.
- `billingPortal.configurations.list` has no metadata filter; page through all active non-default
  ones and match in code. **A list omits `features.subscription_update.products`** unless you pass
  `expand: ['data.features.subscription_update.products']` (retrieve: `features.subscription_update.products`);
  checked in test mode 2026-10-26. A metadata match is used only if its key features still match
  (`isPlanChangeConfiguration()` / `isCancelConfiguration()` in lib/stripe.ts), else a new one is
  made and the edited one logged. Configurations can't be deleted, only deactivated
  (`configurations.update(id, { active: false })`).

Testing: probing Stripe test mode from a script needs `createRequire(<packages/web>/package.json)`
to load the SDK, the key read from `.env.local` inside the script (never printed), and the
`sk_test_` prefix checked first. Deactivate probe configurations afterwards. To run the app's own
TS (`createPlanSwitchSession()`, `planChangeAlarms()`) against test mode: run tsx from
`packages/web` (the root has none; `packages/extension/node_modules/.bin/tsx` works), set
`process.env` from `.env.local` before a dynamic `import(pathToFileURL(<abs path>).href)` (a bare
Windows path fails with ERR_UNSUPPORTED_ESM_URL_SCHEME; `isStripeConfigured` is read at import).

Related: [[webhook-subscription-id-matching]], [[ai-allowance-and-credit-packs]],
[[promotion-codes-checkout]].
