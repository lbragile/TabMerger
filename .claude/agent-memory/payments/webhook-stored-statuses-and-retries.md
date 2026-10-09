---
name: webhook-stored-statuses-and-retries
description: The Stripe webhook's response rules (updates and failed payments write the subscription's current state retrieved from Stripe, not the event's copy; a status the database does not store is written as canceled/free; canceled always goes with free; a failed database call or Stripe read answers 500 so Stripe redelivers), where the stored-status list lives, and the gotchas in implementing and testing them
metadata:
  type: reference
---

Rules the code follows (see `docs/PAYMENTS.md`: "What is written is Stripe's current state",
"Stored statuses" and "What the handler answers"):

- **An event says which subscription changed, not what to write.** Stripe does not deliver events
  in order and redelivers failed ones for days. `customer.subscription.updated` and
  `invoice.payment_failed` call `retrieveCurrentSubscription()` (the helper
  `checkout.session.completed` also uses) and write what Stripe has now.
  `customer.subscription.deleted` writes the ended state without a read, because ending is final.
- **Takeover rule.** `resolveSubscriptionUserId()` returns `{ userId, via }` (`stored_row`,
  `metadata`, `profile`). The `updated` upsert rewrites the user's one row, so a subscription
  resolved by anything but `stored_row` is written only while its retrieved status is entitled
  (`isEntitledSubscriptionStatus`); otherwise nothing is written, 200, one "ignored: the
  subscription is not the one on record" line. The tracked subscription is written whatever its
  status. A completed checkout is exempt (the paid session is the authority); `deleted` and
  `payment_failed` only touch the row stored under their subscription id.
- **Retrieve outcomes.** `resource_missing` (404): nothing written, 200, the unmatched log line
  (a completed checkout is the exception: 500). Any other failure, or an answer whose id is not
  the id asked for: nothing written, 500. The event's embedded object is never the fallback.
- **A row only holds a stored status.** `STORED_SUBSCRIPTION_STATUSES` in
  `packages/shared/src/constants/index.ts` is the one list (it equals the CHECK list on
  `subscriptions.status` and the `SubscriptionStatus` type). Every write of `status` in the webhook
  goes through `toStoredState()`: `canceled` is always written with tier `free`; another stored
  status is written as is with the tier of the price; any other Stripe status (`unpaid`, `paused`,
  `incomplete_expired`, a future one) is written as `canceled` / `free`. A later event that finds
  a stored status writes the plan back.
- **200 means "recorded, or nothing to record"; 500 means "could not be recorded this time".**
  Failed database calls and failed Stripe reads throw a `WebhookRetryError` to the handler's outer
  catch, whose message is the whole log line. An event that matches no row or user, an unknown
  price, and a duplicate credit pack (23505) stay 200.
- Decision: adding a status to the CHECK list is a migration plus one entry in the shared list;
  the entitled list (`ENTITLED_SUBSCRIPTION_STATUSES`) is separate and is not touched by that.

Things that are easy to get wrong:

- **A Stripe SDK error is told apart by its fields**: `code === 'resource_missing'` (with
  `statusCode` 404, `type` `StripeInvalidRequestError`). `type` and `statusCode` are safe to log;
  the error object is not (it carries `headers`, `requestId`, `raw`).
- **A canceled or expired subscription is still retrievable** and reports its final status, so a
  late event for it writes the ended state.
- **`.single()` reports "no row" as an error** (`PGRST116`, also used for more than one row). In a
  handler where "no row" is a normal miss, only a different code is a database error.
  `.maybeSingle()` returns `data: null, error: null` for no row, so any error there is real.
- **Log a database error's `code` and `message`, never the object.** Its `details` can quote the
  failing row ("Failing row contains (...)") and key values. The log line format is
  `Stripe webhook: <event type> <step> failed (subscription <id>, code <code>)`.
- **A Next.js `route.ts` may only export route handlers and config**, so helpers like
  `toStoredState()` stay private and are tested through `POST`.
- **"Idempotent" here means the same event delivered twice.** Order independence is a separate
  property and comes from writing the retrieved state.
- **Tests** (`__tests__/stripeWebhook.test.ts`). `subscriptionEvent()` also sets what
  `stripe.subscriptions.retrieve` answers to the event's own object; call `stripeNowHas({...})`
  afterwards when Stripe's state should differ, `stripeApiError({...})` with
  `mockRejectedValue` for a failed read, `paymentFailedEvent(id)` for an invoice event. That
  describe resets the retrieve mock in `beforeEach` (`vi.clearAllMocks()` keeps a
  `mockResolvedValue` from an earlier test), so a test that forgets Stripe's state gets a 500.
  `mockTables()` takes `rowError`, `profileLookupErrors` (keyed by the column looked up),
  `updateError` and `profileUpdateError`; an upsert error is
  `mockUpsert.mockResolvedValueOnce({ error })`. `__tests__/storedSubscriptionStatusesSqlDrift.test.ts`
  compares the shared list with the CHECK in migration 001: if a later migration replaces that
  constraint, the test has to read the new migration.
- **Stripe retries a failed delivery with backoff for up to three days in live mode**, far fewer
  times in a sandbox. A failure that is permanent (a constraint the row can never satisfy) is
  retried for the whole window and shows as a failed delivery in the dashboard.
