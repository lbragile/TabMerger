import { isEntitledSubscriptionStatus } from '@tabmerger/shared'
import type Stripe from 'stripe'
import { OPEN_SUBSCRIPTION_STATUSES, listCustomerSubscriptions } from '@/lib/stripe'
import { describeStripeError } from '@/lib/stripeErrors'
import { getPlanForPriceId } from '@/lib/tiers'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  SubscriptionSyncError,
  isStripeResourceMissing,
  recordLiveSubscription,
} from '@/lib/subscriptionSync'

/**
 * What Stripe says about selling a new subscription to an account's existing Stripe customer
 * (checkStripeBeforeCheckout()):
 * - `clear`: no subscription that is live or can come back; sell.
 * - `customer_missing`: Stripe has no such customer in this account and mode (`resource_missing`);
 *   sell without it, so Checkout makes a new customer (the completed webhook links it).
 * - `live`: an entitled subscription exists; refuse. `recorded` says whether the account's row now
 *   shows it (written here from Stripe when it didn't).
 * - `open`: one that can still be paid or resumed exists (unpaid, paused, incomplete); refuse.
 * - `check_failed`: the list couldn't be read in full; refuse (fail closed).
 */
export type CheckoutGuard =
  | { kind: 'clear' }
  | { kind: 'customer_missing' }
  | { kind: 'live'; recorded: boolean }
  | { kind: 'open' }
  | { kind: 'check_failed' }

/**
 * Asks Stripe, before a Checkout Session is created, whether the account's customer already has a
 * subscription, so no account ends up with two. The database row is checked first by the route;
 * this covers a row that is behind Stripe (a missed webhook delivery).
 *
 * A live subscription that the row doesn't show is written to the row from Stripe
 * (recordLiveSubscription(), the webhook's own write) when its price is one this deployment sells,
 * and logged in one line; on any other price nothing is written and one line is logged. Either
 * way the checkout is refused. A failed write is logged and the checkout still refused.
 */
export async function checkStripeBeforeCheckout(userId: string, customerId: string): Promise<CheckoutGuard> {
  let subscriptions: Stripe.Subscription[]
  try {
    subscriptions = await listCustomerSubscriptions(customerId)
  } catch (err) {
    // Only "no such customer" on the first page (param `customer`): any other resource_missing (a
    // later page, a bad cursor) fails closed like every other failure.
    if (isStripeResourceMissing(err) && (err as { param?: unknown }).param === 'customer') {
      // No subscription can exist on a customer Stripe doesn't have, so a new customer is safe.
      console.warn('Checkout: Stripe has no customer for this account (resource_missing); checkout makes a new one')
      return { kind: 'customer_missing' }
    }
    console.error(`Checkout: reading the customer's subscriptions failed; nothing sold: ${describeStripeError(err)}`)
    return { kind: 'check_failed' }
  }

  const live = subscriptions.filter((s) => isEntitledSubscriptionStatus(s.status))
  if (live.length > 0) return { kind: 'live', recorded: await recordFirstKnown(live, customerId, userId) }

  if (subscriptions.some((s) => OPEN_SUBSCRIPTION_STATUSES.includes(s.status))) return { kind: 'open' }
  return { kind: 'clear' }
}

/** Writes the first live subscription on a known single price to the row; true when written. */
async function recordFirstKnown(live: Stripe.Subscription[], customerId: string, userId: string): Promise<boolean> {
  const known = live.find((s) => s.items.data.length === 1 && getPlanForPriceId(s.items.data[0]?.price?.id))
  if (!known) {
    console.warn(
      `Checkout: refused; the customer has a live subscription on a price this deployment doesn't sell, not recorded (subscription ${live[0].id})`
    )
    return false
  }

  try {
    const result = await recordLiveSubscription(await createServiceRoleClient(), known.id, customerId, userId)
    if (!result.recorded) {
      console.warn(`Checkout: refused; a live subscription was found but not recorded (subscription ${known.id}, ${result.reason})`)
      return false
    }
    console.warn(
      `Checkout: refused and recorded a live subscription the row was missing (subscription ${known.id}: ${result.tier}/${result.status})`
    )
    return true
  } catch (err) {
    console.error(
      err instanceof SubscriptionSyncError
        ? err.message
        : `Checkout resync failed (subscription ${known.id}): ${describeStripeError(err)}`
    )
    return false
  }
}
