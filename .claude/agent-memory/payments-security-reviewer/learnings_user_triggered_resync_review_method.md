---
name: learnings-user-triggered-resync-review-method
description: How to audit a user-triggered "correct the row from Stripe" path (plan switch drift resync) — key provenance, write-by-id, non-entitled-only, revivable statuses, flag ordering
metadata:
  type: reference
---

Checklist for any route a signed-in user can call that writes `subscriptions` from Stripe's state
(first seen: the plan switch's drift resync, `resyncEndedSubscription()` in `lib/subscriptionSync.ts`).

1. **Key provenance.** The subscription id must come from the caller's own row read with the
   cookie-scoped client (RLS select-own; client writes to `subscriptions` revoked by migration 023),
   and the customer id from `profiles` (client writes revoked by migration 021). If either became
   client-writable, the ownership check would compare two attacker-chosen values.
2. **Write keyed on the subscription id, never user_id.** A concurrent checkout's webhook upserts
   on `user_id` and changes the row id, so an update by the old id matches nothing (`no_row`)
   instead of overwriting the new plan.
3. **Ownership = `subscription.customer === profile.stripe_customer_id`**, checked on the freshly
   retrieved object, plus `resource_missing` treated as "do nothing" (a wrong account or mode key
   must never end real plans).
4. **Non-entitled only.** Re-check `isEntitledSubscriptionStatus` on the retrieved object. Note the
   stored-but-not-entitled `incomplete` status is written with the price's tier (not forced to free)
   and keeps `ai_monthly_credits`; harmless because every server gate (`hasCloudSync`, `has_cloud_sync()`,
   `lib/ai-usage.ts`) also requires an entitled status, but verify that stays true.
5. **"No entitled subscription" needs the whole list.** `subscriptions.list` without a status filter
   returns every non-canceled subscription; require `has_more !== true` and zero entitled entries,
   and never treat a live subscription on an unknown price as ended.
6. **Revivable statuses.** `unpaid`, `paused` and `incomplete` are listed, not entitled, and can
   become `active` again (invoice paid, resume). Any flow that steers the user to a NEW checkout
   when only those exist can end with two billing subscriptions; ask how the design handles it.
7. **Flag ordering.** AI/BYOK availability and price configuration should be checked before the
   correction runs, so a disabled option never triggers a write or yields a checkout target.
   The checkout target itself is not a privilege: `/api/checkout` re-validates tier, interval,
   aiMode, both AI flags and the one-subscription rule.

Related: [[learnings-webhook-retry-review-method]], [[learnings-mocked-gate-return-values]].
