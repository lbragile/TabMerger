---
name: schedule-release-review-method
description: Auditing a user-triggered subscriptionSchedules.release() ("keep my current plan") or a portal cancel flow that releases a schedule
metadata:
  type: reference
---

A schedule release leaves the subscription on its current price, period and discounts. It
creates no proration, invoice or balance change. So the credit question is easy, and the real
questions are which schedules a user may release and what else releases them:

1. **Ownership chain.** Take the subscription id from the server-written row and the customer
   from the server-managed profile, and compare `subscription.customer` with it. Also check that
   `schedule.subscription` and `schedule.customer` match. Ids from the body are ignored.
2. **Which schedules count as releasable.** "Next phase price differs from the current one"
   matches every schedule, not only downgrades. A price-increase migration, an intro price that
   steps up, or an operator-made schedule would be undone too, and the subscriber keeps the cheaper
   price. Ask whether release is limited to known plans moving to a non-upgrade target, or to
   schedules tagged by our own code.
3. **Other release paths.** Stripe's `subscription_cancel` portal flow releases the schedule and
   sets `cancel_at_period_end`. A "renew" afterwards in the default portal is then the same as a
   release. Any guard from step 2 must also cover opening the cancel flow.
4. **Timing.** After the change lands (the 1-second phase 2, or a released or completed schedule),
   the reading must say "nothing pending". A release that fails because it raced the landing should
   re-read and answer 409, not 500.
5. **Webhook.** `customer.subscription.updated` with `previous_attributes: { schedule }` only must
   re-sync the same tier and must not trip the plan-change alarm.

Related: [[amount-driven-portal-deferral-review-method]], [[prorated-option-switch-review-method]]
