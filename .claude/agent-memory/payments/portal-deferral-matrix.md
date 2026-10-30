---
name: portal-deferral-matrix
description: Measured (test mode, real confirm page, test clocks, 2026-10-26) when the Billing Portal's subscription_update_confirm defers a change via schedule_at_period_end - same product vs cross product, decreasing_item_amount vs shortening_interval, the schedule it makes, the webhook events, and what customers see (nickname never, subscription.description only in the portal home)
metadata:
  type: reference
---

Method: per-target configuration (only the target Price, `always_invoice`), a
`subscription_update_confirm` session, the confirm page clicked in headless Chromium (no API can
submit a portal session), then the test clock advanced past period end. API version
2025-06-30.basil. Prices: Pro $3.99/$42.99, Pro AI $7.99/$85.99, own key $5.99/$64.49.

**`decreasing_item_amount` (config conditions = decreasing + shortening):**
- Same product: compares the raw unit amounts. Monthly → yearly was never deferred, even when the
  yearly costs less per month (Pro M → Pro Y; Pro AI M → Pro Y; Pro AI M → own key Y: all
  immediate, prorated charge). Same-interval cheaper target: deferred.
- Across products it deferred too, which the docs say it can't ("only ... between prices that have
  the same product"). It seems to compare per-month amounts: Pro AI M → Pro Y, Pro AI M → own
  key Y and own key M → Pro Y were deferred, while upgrades (Pro M → Pro AI Y / own key Y, own key
  M → Pro AI Y) applied at once. Same-interval cross-product downgrades (Pro AI → Pro, managed →
  own key, own key → Pro, monthly and yearly) all deferred and landed. Undocumented, so it may change
  without notice: production relies on it only with the webhook alarm ([[plan-change-alarm]]).
- Rerun 2026-10-26 through the app's own `createPlanSwitchSession()` with the v2 configuration:
  managed M → own key M and own key M → Pro Y deferred (1-second schedule phase) and landed, no
  credit, balance 0.
- `shortening_interval` deferred only within one product. Across products, Pro Y → Pro AI M applied at
  once with a -$35.00 customer balance credit.
- Same-interval cheaper target with only `shortening_interval` (or `conditions: []`, which is
  accepted): applied at once with a credit (Pro AI Y → Pro Y: -$43.00 balance).

**What the portal makes when it defers:** `subscription_schedule` (`end_behavior: release`), phase 1 =
current price to period end, phase 2 = target price lasting **1 second**, both
`proration_behavior: create_prorations`. No `pending_update`. At period end the price changes,
the renewal invoice is exactly the new price (no proration lines), and the schedule is released.
Monthly → yearly landing: `billing_reason: subscription_update` and a new anchor.
Events at confirm: `billing_portal.session.created`, `subscription_schedule.created`,
`customer.subscription.updated` (previous_attributes: `schedule`), `subscription_schedule.updated`.
At landing: `invoice.created`, `customer.subscription.updated` (items/plan/period/latest_invoice;
the event's object still has `schedule` set, verified in the event payload),
`subscription_schedule.updated`, `customer.subscription.updated` (`schedule`),
`subscription_schedule.released`, then the invoice payment events.

**Config limits:** a configuration can't list two Prices of one product with the same interval
("its price must have unique billing intervals"). One price per configuration is fine.

**What customers see (one product named "TabMerger"):** the confirm page shows product name, product
description and "US$3.99 / month"; Checkout says "Subscribe to TabMerger"; invoice lines read
"1 × TabMerger (at $5.99 / month)", proration lines "Unused time on TabMerger after …". The price
nickname appears nowhere. `subscription.description` shows only on the portal home ("Active
plans") and not on Checkout, the hosted invoice or the PDF (the account's default memo fills the
invoice description). What does show: Checkout `custom_text.submit` (above the Subscribe button)
and `customer.invoice_settings.custom_fields` (on every later invoice for that customer).

**Discounts (2026-10-26):** the portal's phase 2 carries every subscription-level discount by id,
even a coupon whose `applies_to` lists only the old product; it stays on the subscription after the
landing. A from_subscription schedule's phase 0 lists the same discounts as `coupon` entries (not
`discount` ids); passing them back doesn't replace the existing `di_` objects.

**Cancel while a schedule is pending (portal-made and server-made, 2026-10-26):** the portal home
(default config, cancel on) shows "Plan updates on {date}" + next amount and no cancel control. A
session with `flow_data.type: subscription_cancel` is accepted and its "Cancel plan" click releases
the schedule (status `released`, current price kept) and sets `cancel_at_period_end`.

Test clocks advance at most two intervals of the shortest price at a time (yearly → monthly
needs ~6 steps of 58 days). Deleting a clock deletes its customers. Deactivate probing configs
afterwards (the lookup pages through every active one, so they only add list calls).

An immediate cheaper change (`subscriptions.update` with `always_invoice`, Pro AI M → Pro M): one
`customer.subscription.updated` with previous_attributes `items, latest_invoice, plan`, object
`schedule: null`, and a `subscription_update` invoice of -$4.00 (ending_balance -400).

Related: [[refund-policy-plan-changes]], [[plan-change-alarm]].
