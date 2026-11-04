import type Stripe from 'stripe'

/**
 * Whether a subscription is set to end when its current paid period ends, the meaning of the
 * stored `subscriptions.cancel_at_period_end` column. Stripe expresses a cancellation at period end
 * in two ways, and which one depends on the subscription's billing mode, not on us:
 *
 * - `cancel_at_period_end: true` (classic billing mode; the API with `cancel_at_period_end`). Stripe
 *   also fills `cancel_at` with the period end then.
 * - `cancel_at` set to the period end with `cancel_at_period_end: false`: what the Billing Portal's
 *   cancel page does for a `flexible` billing-mode subscription, which every Checkout made on API
 *   2026-03-25.dahlia creates (seen in test mode, 2026-11-02).
 *
 * So the plan ends with this period when the flag is true, or `cancel_at` is at or before the
 * current period's end (`items.data[0].current_period_end`). A `cancel_at` after it means the plan
 * still renews at least once, which the column can't call "set to end": false. A `cancel_at` with no
 * period end to compare against is read as set to end (nothing renews that can't be shown).
 *
 * Kept free of imports other than types: scripts/resync-ai-allowance.ts runs it under plain tsx.
 */
export function isSetToEndAtPeriodEnd(
  subscription: Pick<Stripe.Subscription, 'cancel_at' | 'cancel_at_period_end'> & {
    items?: { data?: Array<{ current_period_end?: number | null }> } | null
  }
): boolean {
  if (subscription.cancel_at_period_end === true) return true
  const cancelAt = subscription.cancel_at
  if (typeof cancelAt !== 'number') return false
  const periodEnd = subscription.items?.data?.[0]?.current_period_end
  if (typeof periodEnd !== 'number') return true
  return cancelAt <= periodEnd
}
