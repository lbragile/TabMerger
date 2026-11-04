---
name: plan-change-alarm
description: The webhook's report-only (log + Sentry) refund-policy alarm (lib/planChangeAlarm.ts) - its two signals, why it reads the event object for `schedule` but the retrieved subscription for the invoice, why no extra webhook event is needed, and what it can't see
metadata:
  type: reference
---

`customer.subscription.updated` → `syncSubscription()` (now returns the retrieved subscription) →
`planChangeAlarms(event.data, current)` → one `console.error` line per alarm, prefix
`Stripe webhook: PLAN_CHANGE_ALARM`. Runs after the write so a 500 redelivery doesn't log twice;
never mutates, never changes the answer.

Signals (both verified on real test-mode events, 2026-10-26):
- `lowered_at_once`: previous_attributes price (items.data[0].price, or legacy top-level `plan`)
  differs from the object's, `classifyPlanChange` says not `upgrade`, and the **event object's**
  `schedule` is null. Must be the event object: a deferred change (portal or server schedule) lands
  in an update whose object still has `schedule` set, and Stripe detaches it in the next update, so
  the retrieved subscription would already show null (false alarm). Unknown prices are skipped.
- `credit`: only when previous_attributes contains `latest_invoice` and the retrieved
  (`SUBSCRIPTION_EXPAND` expands `latest_invoice`) invoice id equals the event object's: then
  `billing_reason === 'subscription_update'` and `total < 0` or `ending_balance < starting_balance`.
  The id match keeps later events from re-alarming and avoids a second Stripe call.

Also sent to Sentry (`captureMessage`, level error, fingerprint `['plan-change-alarm', kind]`) and
flushed with `after(flushPlanChangeAlarms)`: route handlers aren't reliably wrapped by Sentry's
auto-flush. The loop is in try/catch (one log line, still 200). Tests: `vi.mock('@sentry/nextjs')`
in planChangeAlarm.test.ts; the webhook test runs the real SDK (no DSN → no-op) and checks
`afterTasks`. A throwing `previous_attributes` getter is how to make the check fail in a test.

Why no `invoice.*` event: the endpoint isn't subscribed to them (PAYMENTS.md setup lists the
events), and an `always_invoice` change already sets `latest_invoice` in the same update.

Blind spots: a credit created with `create_prorations` (lands as negative lines on the next
`subscription_cycle` invoice), and a race where a newer invoice replaced the one the event set.

Upgrades can't net negative at list prices: every upgrade's new period price exceeds the old one
(same interval: higher price; monthly → yearly: every yearly ≥ $42.99 > every monthly ≤ $7.99),
pinned by refundPolicy.test.ts (list prices, no discounts).

Related: [[portal-deferral-matrix]], [[refund-policy-plan-changes]],
[[webhook-stored-statuses-and-retries]].
