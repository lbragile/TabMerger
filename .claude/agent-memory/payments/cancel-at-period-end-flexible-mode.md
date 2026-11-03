---
name: cancel-at-period-end-flexible-mode
description: How Stripe records "ends at period end" per billing mode (portal sets only cancel_at on flexible), the stored cancel_at_period_end reading, and undoing a cancellation (resumeSubscription, cancel_at '') - measured on test clocks 2026-11-02
metadata:
  type: reference
---

**Two shapes of "set to end".** Classic billing mode: `cancel_at_period_end: true` and Stripe also
fills `cancel_at` with the period end. Flexible billing mode (every Checkout made on
`2026-03-25.dahlia`, i.e. CHECKOUT_API_VERSION, creates one; `billing_mode.type: flexible`): the
portal's cancel page sets only `cancel_at` = period end and leaves `cancel_at_period_end` false.
The event's `previous_attributes` were `cancel_at, canceled_at, cancellation_details`. Earlier
test-clock subscriptions (created via the API on basil, classic mode) showed the flag, which is
why older notes say "sets cancel_at_period_end". Always test cancellation on a Checkout-made
(flexible) subscription too.

**Stored flag.** `subscriptions.cancel_at_period_end` = `isSetToEndAtPeriodEnd()`
(lib/subscriptionEnd.ts): flag true, or `cancel_at <= items.data[0].current_period_end`. A
`cancel_at` after the period end still renews once, so false. Decision: no `cancel_at` column; every
reader only needs "ends with this period". The re-sync script (scripts/resync-ai-allowance.ts) also
rewrites the flag on `pro` and `pro_ai` rows. Server checks read Stripe and use
`cancel_at_period_end || cancel_at`.

**Undo (measured, classic and flexible, by running resumeSubscription() itself):**
- `subscriptions.update(id, { cancel_at: '' })` alone clears BOTH `cancel_at` and
  `cancel_at_period_end` in both modes. No invoice, no pending items, balance 0, same period end and
  anchor, next-invoice preview at full price, renewal `subscription_cycle` at full price.
- Passing `cancel_at` and `cancel_at_period_end` together: 400 with no `code`, "Received both
  cancel_at_period_end and cancel_at parameters. Please pass in only one."
- Repeating the clear on a renewing subscription is accepted and changes nothing (no error), so a
  double click can't be detected by error; read first.
- Any update on a canceled subscription: 400 `invalid_canceled_subscription_fields`.
- A `cancel_at` 10 days before the period end (Dashboard-style cut) moved `current_period_end` to
  it but left `billing_cycle_anchor` unchanged, in both modes (the docs say the anchor moves). So
  `ends_early` counts the natural end from `current_period_start` on the anchor's day of month,
  clamped (anchor 31st: Feb 28 → Mar 31, measured on a test clock in both modes); counting from the
  start's own clamped day missed up to 3 cut days. An anchor after the start is ignored. Clearing
  such a date would hand the cut time back unpaid, so the route refuses it.
- A subscription with a schedule attached is refused (`schedule_attached`): the portal's cancel
  releases schedules, so only a Dashboard-made one can be there, and with `end_behavior: cancel`
  it manages `cancel_at` itself.

Related: [[cancel-with-pending-schedule]], [[keep-current-plan-release]], [[billing-request-guards]],
[[plan-change-client-confirmation]].
