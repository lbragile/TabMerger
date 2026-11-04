---
name: payment-reversal-review-method
description: How to audit dispute/refund webhook handling that re-reads the charge from Stripe and revokes/restores a grant or cancels a subscription; plus allowance freezes done by trigger
metadata:
  type: reference
---

Questions to ask when a webhook handles `charge.dispute.*` / `charge.refunded` by reading the
charge's current state from Stripe and writing a flag (e.g. `revoked_at`) or cancelling:

- **Insert-on-missing fallback.** If the revoke path inserts the row already revoked when the grant
  hasn't landed yet, check what happens when the grant's insert wins the race between the revoke's
  UPDATE (0 rows) and its INSERT (23505). Treating 23505 as "unchanged" leaves the grant live;
  the fix is to run the guarded UPDATE again after a 23505.
- **Read-then-write without a lock.** "Current state decides" makes redeliveries and out-of-order
  events safe only when they're processed one after another. Two concurrent events for one
  charge can each read and then write in the opposite order. Ask which event comes next and
  repairs it, and how long the wrong state lasts until then.
- **Which events carry the transition.** Check the cases the handler subscribes to against the
  transitions it relies on (an inquiry escalating, funds withdrawn or reinstated). Because the
  handler is driven by current state, extra event types cost nothing.
- **Chargeback vs inquiry.** `warning_*` statuses mean no money has moved. A cancel must key on
  `needs_response`/`under_review`/`lost` only. `prevented` and `warning_closed` are not contested.
- **Cancel side effects.** `subscriptions.cancel` with no `invoice_now`/`prorate` creates no credit
  or invoice. Check that a test pins the absence of those options, and that the row write after the
  cancel is idempotent (on redelivery the subscription is already canceled, so only the write runs).
- **Month of an inserted grant.** A grant row inserted by the reversal path is dated by a different
  clock (the session's creation) than the normal grant (processing time). Check which month bucket
  a later restore puts the credits in.

For an allowance that a writer sets to 0 for some statuses, with a trigger recording what was
already spent:
- Check whether the SQL cap function also filters by status, or relies only on the column value.
  If it relies on the column, rows written before the deploy need a backfill or re-sync.
- Check the invariant `spent <= used`. It must hold on every path that lowers `used` (the
  settlement, an upsert's ON CONFLICT UPDATE), so the frozen figure alone never opens headroom.
- Check that a redelivered write of 0 doesn't fire the trigger again (`WHEN old > 0 AND new = 0`).

Related: [[webhook-retry-review-method]], [[reserve-settle-bound-review-method]], [[usage-bucket-vs-billing-period]].
