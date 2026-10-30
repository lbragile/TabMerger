import type Stripe from 'stripe'
import { creditsForPayment } from '@tabmerger/shared'
import { databaseError, type ServiceRoleClient } from '@/lib/subscriptionSync'

/**
 * AI credit packs on the webhook side: granting a paid pack (`ai_credit_purchases`) and turning
 * its credits off and on again while its payment is disputed or refunded (`revoked_at`, migration
 * 027, which `ai_reserve_credits` reads). Used by app/api/webhooks/stripe/route.ts and
 * lib/paymentReversals.ts.
 */

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

/** True for a Checkout Session that sold an AI credit pack (stamped by the credit checkout route). */
export function isCreditPackSession(session: Pick<Stripe.Checkout.Session, 'mode' | 'metadata'>): boolean {
  return session.mode === 'payment' && session.metadata?.type === 'ai_credit_pack'
}

/**
 * What the buyer paid for a Checkout Session, in USD: its total after any promotion code (the
 * GA4 `purchase` value, and what a credit pack's credits are worked out from). Null when the
 * session holds no USD total.
 *
 * Adaptive Pricing lets the buyer pay in a local currency, and where the USD total sits depends
 * on the API version of the webhook endpoint (the event payload follows it, not this client):
 * older versions put the local amount in `amount_total`/`currency` and the USD one in
 * `currency_conversion.amount_total` (`source_currency` 'usd'); current versions keep
 * `amount_total`/`currency` in USD and the local amount in `presentment_details`. Both are read.
 */
export function usdAmountPaid(session: Stripe.Checkout.Session): number | null {
  const conversion = session.currency_conversion
  if (
    conversion?.source_currency?.toLowerCase() === 'usd' &&
    typeof conversion.amount_total === 'number'
  ) {
    return conversion.amount_total / 100
  }
  if (session.currency?.toLowerCase() === 'usd' && typeof session.amount_total === 'number') {
    return session.amount_total / 100
  }
  return null
}

/** The UTC month ('YYYY-MM') of a Unix time in seconds, or of now. */
function utcMonth(unixSeconds?: number): string {
  const date = typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : new Date()
  return date.toISOString().slice(0, 7)
}

/**
 * Grants a one-time AI credit pack purchase: creditsForPayment() of the USD amount actually paid
 * for it (usdAmountPaid()), in the cost-based unit (1 credit = $0.001 of AI cost). The quantity
 * bought only set the price; a discounted pack grants proportionally fewer credits and a free one
 * none. When the session holds no USD amount, 0 credits are granted and a line is logged (better
 * to under-grant than to fund AI with money that wasn't received).
 *
 * Only a session whose `payment_status` is `paid` is granted. A delayed payment method completes
 * the session `unpaid` and grants nothing then; `checkout.session.async_payment_succeeded` calls
 * this again once the money has arrived. `no_payment_required` (a 100%-off code) has nothing to
 * grant.
 *
 * Idempotent on stripe_checkout_session_id (unique constraint on ai_credit_purchases) — Stripe can
 * redeliver the event, and a duplicate insert must be a no-op, not a double credit. A pack whose
 * row was already written as revoked (its dispute was handled first) stays revoked. Any other
 * insert error throws a SubscriptionSyncError (500), so the event is delivered again.
 */
export async function grantCreditPack(
  supabase: ServiceRoleClient,
  eventType: string,
  session: Stripe.Checkout.Session
): Promise<void> {
  if (session.payment_status !== 'paid') {
    console.warn(
      `Stripe webhook: ${eventType} credit pack not paid (${session.payment_status ?? 'unknown'}); nothing granted (session ${session.id})`
    )
    return
  }
  await insertCreditPack(supabase, eventType, session, { month: utcMonth(), revoked: false })
}

/**
 * Inserts a credit pack's row. Returns false when a row for the session already exists (23505),
 * and when the session has no `metadata.user_id` (logged); throws a SubscriptionSyncError for any
 * other database error.
 */
async function insertCreditPack(
  supabase: ServiceRoleClient,
  eventType: string,
  session: Stripe.Checkout.Session,
  { month, revoked }: { month: string; revoked: boolean }
): Promise<boolean> {
  const userId = session.metadata?.user_id
  if (!userId) {
    console.error(`Stripe webhook: ${eventType} credit pack missing user_id metadata (session ${session.id})`)
    return false
  }

  const usdPaid = usdAmountPaid(session)
  if (usdPaid === null) {
    console.warn(
      `Stripe webhook: ${eventType} credit pack has no USD amount; 0 credits granted (session ${session.id})`
    )
  }
  const credits = usdPaid === null ? 0 : creditsForPayment(usdPaid)

  const { error } = await supabase.from('ai_credit_purchases').insert({
    user_id: userId,
    month,
    credits,
    stripe_checkout_session_id: session.id,
    ...(revoked ? { revoked_at: new Date().toISOString() } : {}),
  })

  if (error?.code === UNIQUE_VIOLATION) return false
  if (error) {
    throw databaseError(eventType, 'credit pack insert', `session ${session.id}`, error, {
      withMessage: true,
    })
  }
  return true
}

/**
 * Turns a credit pack's credits off (`revoked`: its payment is disputed or refunded) or back on
 * (the dispute was won), by setting or clearing `ai_credit_purchases.revoked_at` on the row of
 * its Checkout Session. Writes only when the row is not already in that state, so running it
 * again changes nothing, and it is given the charge's current state, so the order events arrive
 * in doesn't matter.
 *
 * A pack being revoked before its grant was recorded (the completed checkout is still being
 * retried) gets its row inserted already revoked, from the session (month of the session's
 * creation); the grant's insert then finds it and leaves it revoked. A pack being restored with
 * no row is left to the grant.
 */
export async function setCreditPackRevoked(
  supabase: ServiceRoleClient,
  eventType: string,
  session: Stripe.Checkout.Session,
  revoked: boolean
): Promise<'revoked' | 'restored' | 'unchanged'> {
  if (await updateRevokedAt(supabase, eventType, session.id, revoked)) return revoked ? 'revoked' : 'restored'
  if (!revoked) return 'unchanged'

  const inserted = await insertCreditPack(supabase, eventType, session, {
    month: utcMonth(session.created),
    revoked: true,
  })
  if (inserted) return 'revoked'

  // The insert met an existing row (23505): the grant inserted it between the update above and
  // this insert, unrevoked. Revoke it now; a row that is already revoked stays as it is.
  return (await updateRevokedAt(supabase, eventType, session.id, true)) ? 'revoked' : 'unchanged'
}

/**
 * Sets (`revoked`) or clears `revoked_at` on a session's pack row, only where it is not already in
 * that state. True when a row changed; a database error throws a SubscriptionSyncError (500).
 */
async function updateRevokedAt(
  supabase: ServiceRoleClient,
  eventType: string,
  sessionId: string,
  revoked: boolean
): Promise<boolean> {
  const base = supabase
    .from('ai_credit_purchases')
    .update({ revoked_at: revoked ? new Date().toISOString() : null })
    .eq('stripe_checkout_session_id', sessionId)
  const { data: rows, error } = await (revoked ? base.is('revoked_at', null) : base.not('revoked_at', 'is', null)).select('id')

  if (error) {
    throw databaseError(eventType, revoked ? 'credit pack revoke' : 'credit pack restore', `session ${sessionId}`, error, {
      withMessage: true,
    })
  }
  return Boolean(rows?.length)
}
