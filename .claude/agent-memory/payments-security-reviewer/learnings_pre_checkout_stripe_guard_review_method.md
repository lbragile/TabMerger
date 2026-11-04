---
name: learnings-pre-checkout-stripe-guard-review-method
description: How to audit a checkout route that asks Stripe for existing subscriptions before selling, writes a missed live plan upward, and expires other open sessions (two tabs)
metadata:
  type: reference
---

Checklist for a "ask Stripe before selling a subscription" guard (first seen: `checkStripeBeforeCheckout()`
in `lib/checkoutGuard.ts`, `recordLiveSubscription()` in `lib/subscriptionSync.ts`,
`expireOtherOpenSubscriptionCheckouts()` in `lib/stripe.ts`).

1. **Every input the guard depends on must fail closed, not only the Stripe list.** The customer id
   comes from a `profiles` read; wherever that read's `error` is ignored, a DB hiccup yields "no customer"
   and the guard is skipped entirely (sold on a fresh customer, and the completed webhook then
   overwrites `profiles.stripe_customer_id`, orphaning the old customer from the portal). Check that
   a non-PGRST116 error on the profile read stops the request.
2. **`resource_missing` scope.** Treating `resource_missing` as "customer gone, sell on a new one" is
   only sound for the first page and `param === 'customer'`. A later-page error (e.g. a
   `starting_after` object) must not discard earlier pages that held a live subscription. Also ask
   what a wrong-account/wrong-mode key does: the plan switch treats it as "do nothing", checkout as
   "sell" — the asymmetry is a design decision to record.
3. **Expire pass ordering.** Create the new session first, then expire others; skip `keepSessionId`
   and any `mode !== 'subscription'` (credit packs are `payment`). Then ask: what if an expire fails
   because the other session just COMPLETED? The new session stays payable next to a now-live plan.
   The safe response is to expire the new session (or re-run the live check) when any other
   subscription session is found `complete`.
4. **Concurrent expire passes** can expire each other's sessions (both creates before both lists):
   no money risk, only a retry. Stripe list endpoints can lag, so the pass is best effort, not a lock.
5. **Upward write gates.** Re-read by id, `customer === profile.stripe_customer_id`, entitled,
   exactly one item on a known price, metadata `user_id` absent or equal. `profiles.stripe_customer_id`
   is UNIQUE (001) and client-unwritable (021), and `subscriptions.id` collisions with another user's
   row fail the upsert (23505) rather than moving it. Ask about the re-read-to-upsert window: a
   `customer.subscription.deleted` processed inside it updates by id, matches the old `free_` row
   and answers 200, so nothing redelivers. A post-write re-read that ends the row by id when the
   subscription is no longer entitled is the pattern that closes it.
6. **Accepted fix shapes (2026-10-24).** Later-page list errors are re-thrown as a plain `Error`
   whose message embeds `describeStripeError(err)`: the Stripe `code` is dropped (so it can never
   read as `customer_missing`) while type/code/param/request id survive in the log line. The
   two-tab race throws a dedicated error class from `lib/checkoutErrors.ts` (no server imports, so
   route tests that mock `lib/stripe.ts` still see it). The withheld-URL decision fires only on a
   positive `status === 'complete' && mode === 'subscription'` re-read; an unreadable session falls
   back to handing out the URL (decision: never withhold without proof a plan went live).
7. **Logs.** `describeStripeError()` includes Stripe's message (300 chars); invalid-email errors on
   `customer_email` can echo the address. Customer ids and subscription ids are ids, not PII.

Related: [[learnings-user-triggered-resync-review-method]], [[learnings-webhook-retry-review-method]].
