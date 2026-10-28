---
name: keep-current-plan-release
description: Undoing a scheduled plan change by releasing its subscription schedule (route /api/billing/keep-current-plan, keepCurrentPlan() in lib/stripe.ts) - measured money effects, Stripe's error for a second release, ownership checks, and the stay-mounted pattern for a success message that must survive router.refresh()
metadata:
  type: reference
---

`subscriptionSchedules.release(id)` with no params is the whole undo. Measured on test clocks
2026-10-27 (10% forever coupon on each sub), for a portal-made deferral (phases on
`create_prorations`) and a server-made one (phases on `none`): schedule `released` with
`released_subscription` set, subscription `schedule: null`, same price/period/discount, no new
invoice, no pending invoice items, balance 0, 0 credit notes, 0 balance transactions; the
next-invoice preview and the renewal (`subscription_cycle`) were the current price. The phases'
`create_prorations` never applies on release: nothing changes on the subscription itself.

Releasing an already released schedule: HTTP 400 `StripeInvalidRequestError` with **no `code`**,
message "You cannot release a subscription schedule that is currently in the `released` status.
It must be in `not_started, active` status to be released." So a double click is detected by
re-reading the subscription (`pendingChangeOf()` null → 409 `no_scheduled_change`), not by code.

Ownership: the route reads the caller's row + profile customer, `keepCurrentPlan()` re-retrieves
with `expand: ['schedule']`, requires `subscription.customer` = profile customer (else 404), and
`schedule.subscription` / `schedule.customer` to match too (defence in depth; else 409, logged).
`pendingChangeOf()` is shared with `getPendingPlanChange()` so only what the page showed is
released (a schedule whose next phase is the same price is left alone).

UI pattern: the notice block disappears on `router.refresh()`, which would unmount a success
message rendered inside it. `ScheduledChangeNotice` (client) is rendered for every paid account at
a stable position with `notice: null` when nothing is scheduled; it keeps `kept` state and shows
"Your plan stays {plan}." (focused, `role="status"`) across the refresh. The success message's plan
name comes from the row's `stripe_price_id` via the page's `planName()` helper.

Related: [[cancel-with-pending-schedule]], [[portal-deferral-matrix]], [[refund-policy-plan-changes]].
