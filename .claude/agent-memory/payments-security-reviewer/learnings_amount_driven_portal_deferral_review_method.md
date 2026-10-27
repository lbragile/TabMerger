---
name: amount-driven-portal-deferral-review-method
description: Reviewing plan-change timing that relies on a Billing Portal config's schedule_at_period_end conditions (decreasing_item_amount / shortening_interval) plus a log-only alarm on subscription.updated
metadata:
  type: reference
---

When a plan-change flow lets Stripe's confirm page decide "now vs period end" through the
portal configuration's `schedule_at_period_end` conditions:

1. **Enumerate every ordered price pair** (6 prices = 30 pairs) and compare the app's
   classifier (upgrade / downgrade / shorter interval) with what the conditions do. Stripe
   appears to compare per-month amounts across products, so check per-month(to) vs
   per-month(from) for each pair. A downgrade whose per-month amount rises, or an upgrade whose
   per-month amount falls, is where the two disagree. A test asserting this over the price
   table keeps it true when prices change.
2. **Stale sessions are judged by the same rule.** A flow session stays usable for up to an hour
   after the last activity, and the subscription may have moved on by then. If the conditions
   are purely amount-driven and step 1 holds, a stale session can't do anything worse.
3. **Coupons break the amount logic.** A coupon whose `applies_to` covers only the target product
   discounts the new line but not the unused-time credit for the old line, so an upgrade invoice
   can go negative. Ask whether subscription-level discounts survive a deferred change, and
   whether the switch previews the upgrade invoice (`invoices.createPreview`) before sending
   the customer to the portal.
4. **Schedules have side effects.** A subscription with a schedule attached can't be changed
   (and, per the project docs, can't be cancelled) in the portal. Check how long each schedule
   stays attached: the portal's phase 2 lasts one second, while a server phase 2 with
   `duration` lasts a whole interval after the change lands. Compare that with what the Terms
   promise about cancelling.
5. **The alarm.** It should be pure, run after the write, and never be able to turn a 200 into a
   500 (wrap it). `lowered_at_once` should key on the event object's `schedule`, not the
   retrieved one. `credit` should only judge the invoice that update set
   (`previous_attributes.latest_invoice`, `billing_reason: subscription_update`). Its known
   blind spot is credits that come as `create_prorations` lines on a later renewal. Also ask
   whether anything alerts on the log line.

Related: [[prorated-option-switch-review-method]], [[webhook-retry-review-method]]
