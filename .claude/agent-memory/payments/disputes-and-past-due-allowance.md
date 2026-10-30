---
name: disputes-and-past-due-allowance
description: How past_due gets no new managed AI credits without eating credit packs (allowance_spent freeze trigger, migration 027), how disputes/refunds revoke packs or cancel subscriptions from Stripe's current charge state, the paid-only pack grant, and the Stripe facts and test setup behind them
metadata:
  type: reference
---

**past_due allowance (migration 027).** Only `active` earns `ai_monthly_credits`
(`subscriptionAiColumns()`; `updateSubscriptionById()` writes 0 for any stored status but active).
The catch: `ai_usage.credits_used` is ONE counter for the allowance and the month's packs. Zeroing
the allowance alone makes a user who already used allowance lose their packs too (cap = packs,
usage still counts allowance). Fix: trigger `subscriptions_freeze_ai_allowance` (AFTER UPDATE OF
ai_monthly_credits, old > 0 and new = 0, WHEN also old tier pro_ai + managed + entitled status, else
an incomplete row with a stale figure got credits back) sets `ai_usage.allowance_spent =
greatest(previous, least(old allowance, credits_used))` for the current UTC month; reserve locks
the subscriptions row `for share` first, then cap = `greatest(allowance if status active,
allowance_spent) + unrevoked packs`. A clamp trigger plus CHECK keep `allowance_spent <=
credits_used` (a settle can lower usage below a figure taken while a reservation was in flight),
so allowance_spent alone never opens headroom: with no packs, reserve allows iff `used + amount <=
allowance`. Upserts `on conflict do update` fire `UPDATE OF` triggers (pgTAP-checked). A lazy
"min(A, used)" cap without a stored freeze is broken: every pack spend raises `used` and re-opens
headroom. Use `create or replace trigger`, never drop+create on subscriptions (ACCESS EXCLUSIVE
blocks every sync write's RLS read). The drift test now checks reserve's allowance is `s.status =
'active'` and the trigger's `old.status in (...)` = entitled list.

**Disputes/refunds (`lib/paymentReversals.ts`).** Event = which charge; state = `charges.retrieve`
(`refunded` = full refund only) + `disputes.list({ charge })` (a charge can have several; late
wins flip lost → won). Pack: `checkout.sessions.list({ payment_intent })` → `revoked_at` set while
contested (warning_needs_response/under_review, needs_response, under_review, lost) or refunded,
cleared otherwise (won, warning_closed, prevented). Revoke before the grant inserts the row
already revoked; the grant's 23505 keeps it. Subscription: `invoicePayments.list({ payment: {
type: 'payment_intent', payment_intent }, expand: ['data.invoice'] })` (basil: Charge has no
`invoice`), then `invoice.parent.subscription_details.subscription`. Decision: chargeback statuses
(not inquiries) cancel the subscription at once via `subscriptions.cancel(id, {
cancellation_details: { comment } })` (Stripe defaults: no proration, no invoice); no restore on
win. `refundPolicy.test.ts` allows exactly this one cancel.

**Paid-only packs.** `grantCreditPack()` (lib/creditPacks.ts) needs `payment_status === 'paid'`;
`checkout.session.async_payment_succeeded` grants delayed methods. `no_payment_required` grants
nothing (was a 0-credit row before).

Races: two events for one charge can write in reverse read order; the pack path re-reads the charge
after writing and rewrites if the answer changed (max 3 writes, then 500). A revoke whose insert
meets 23505 (grant landed in between) re-runs the guarded update. Also handled:
`charge.dispute.funds_withdrawn` / `funds_reinstated`.

Stripe test mode (2026-10-28, measured): `subscriptions.cancel` on a subscription with a schedule
attached succeeds and Stripe sets the schedule to `canceled` (no release needed). `pm_card_createDispute` on a subscription's first invoice
gives a `needs_response` dispute within ~2 s; the cancel left the invoice paid, 0 credit notes,
balance 0. Test clock + `pm_card_chargeCustomerFail` as default PM, advance past period end: the
subscription is `past_due` with an open renewal invoice; `invoices.pay(id, { payment_method })`
makes it active and the latest invoice is that paid cycle invoice (full allowance).

Testing: `__tests__/stripeWebhookReversals.test.ts` has an in-memory `ai_credit_purchases` fake
(insert with 23505, update with eq/is/not + select) for ordering/idempotency tests. Under the
full web suite the first test of webhook files can hit the 5 s timeout (cold route import);
rerun the file alone before calling it a failure.

Related: [[ai-allowance-and-credit-packs]], [[webhook-stored-statuses-and-retries]],
[[refund-policy-plan-changes]].
