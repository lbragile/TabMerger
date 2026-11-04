---
name: cancel-resume-review-method
description: Auditing a "keep my plan" route that clears a Stripe cancellation (cancel_at / cancel_at_period_end) — ownership, unpaid-time checks, flag display-only, stale-flag UX
metadata:
  type: reference
---

Questions to ask when a route undoes a cancellation at Stripe (`subscriptions.update(id, { cancel_at: '' })`):

1. **Where the id comes from.** Newest `subscriptions` row by user_id (service role) + `profiles.stripe_customer_id`, then `subscription.customer === customerId` at Stripe. Both source columns are server-written only (migrations 021, 023 revoke client writes), so no IDOR. A `free_<uuid>` row id is `resource_missing` -> 404.
2. **Flexible vs classic billing mode.** Flexible (Checkout on dahlia) cancels via `cancel_at` = period end with `cancel_at_period_end: false`. Any server check of "is canceling" must test both fields; a stored flag derived from only one misses cancellations.
3. **Unpaid time.** A `cancel_at` inside the period moves `current_period_end` to it, so `cancel_at == current_period_end` can't tell "portal cancel" from "Dashboard cut short". The comparison has to be against a natural period end computed independently. A natural end counted from `current_period_start` + interval lands earlier than Stripe's on clamped anchors (anchor day 29-31, period starting on a short month's last day), so check which way that error leans; counting from `billing_cycle_anchor`'s day matches Stripe. Check whether a Dashboard cancel with prorations left a credit that the resume would keep.
4. **Statuses.** Entitled = active/trialing/past_due. A dispute cancels immediately (status canceled), so a resume can't undo it: Stripe refuses updates on canceled subs. A past_due resume restores the same state as never cancelling (no new free time). If trials are ever sold, a trial shorter than the interval would read as "ends early" (safe direction, but a false refusal).
5. **Stored flag display-only.** Grep `cancel_at_period_end` in `app/api`, `lib/ai-usage*`, `supabase/migrations`: enforcement (plan switch `cancel_scheduled`) must read Stripe, never the row.
6. **Stale flag UX.** When the row says "set to end" but Stripe doesn't (missed webhook, re-sync script racing a resume), the UI hides plan changes and the route answers `not_canceling` repeatedly. Not a money issue, but ask whether `not_canceling` should trigger a row resync.

Related: [[schedule-release-review-method]], [[user-triggered-resync-review-method]].
