import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { isCreditPackSession, setCreditPackRevoked } from '@/lib/creditPacks'
import {
  SubscriptionSyncError,
  getInvoiceSubscriptionId,
  isStripeResourceMissing,
  retrieveCurrentSubscription,
  updateSubscriptionById,
  type ServiceRoleClient,
} from '@/lib/subscriptionSync'

/**
 * Disputes and refunds (`charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`,
 * `.funds_reinstated`, `charge.refunded`).
 *
 * Like the subscription events, a reversal event only says which charge changed. The handler
 * reads the charge and every dispute on it from Stripe and acts on that current state, so the
 * events of one charge can arrive in any order, and any number of times, with the same result:
 *
 * - **A credit pack's charge** (found through its Checkout Session): the pack is revoked
 *   (`ai_credit_purchases.revoked_at`, which `ai_reserve_credits` ignores) while the charge is
 *   contested (a dispute or inquiry that is open or lost) or fully refunded, and restored when
 *   that is no longer so (a dispute won, a late win, an inquiry closed). Credits already spent
 *   stay spent; only the unspent rest stops working. A partial refund leaves the pack as it is:
 *   refunds are only ever issued by hand, so the owner decides.
 * - **A subscription invoice's charge** with a chargeback (a dispute that is `needs_response`,
 *   `under_review` or `lost`): the subscription is cancelled at Stripe at once (no proration, no
 *   refund, no invoice) and its row is written as ended. The customer has asked their bank for
 *   the money back and Stripe has already taken it from the balance; cancelling stops the next
 *   renewal from being charged and disputed again, which a dispute rate can't afford. A won
 *   dispute does not bring the subscription back (a cancellation is final at Stripe); the
 *   customer can subscribe again. An inquiry (`warning_*`, no money moved yet) changes nothing
 *   until it escalates, which Stripe reports as an update of the same dispute. A refund of a
 *   subscription invoice changes nothing (the owner decides).
 * - Any other charge (no pack session, no subscription invoice) is logged and answered 200.
 *
 * Two events for one charge can be handled at the same moment; a credit pack's state is checked
 * again after it is written (applyPackState()). A subscription only ever moves one way (cancelled),
 * so it needs no re-check.
 *
 * A failed Stripe read, Stripe cancel or database write throws a SubscriptionSyncError (500,
 * Stripe sends the event again).
 */

/** Dispute statuses that mean the money is, or may be, going back to the customer. */
const CONTESTED_STATUSES: ReadonlySet<Stripe.Dispute.Status> = new Set([
  'warning_needs_response',
  'warning_under_review',
  'needs_response',
  'under_review',
  'lost',
])

/** Dispute statuses of a real chargeback (Stripe has taken the funds), not an inquiry. */
const CHARGEBACK_STATUSES: ReadonlySet<Stripe.Dispute.Status> = new Set(['needs_response', 'under_review', 'lost'])

/** The note Stripe keeps on a subscription this handler cancels (Dashboard, `cancellation_details`). */
export const DISPUTE_CANCELLATION_COMMENT = 'Cancelled automatically: a payment for this subscription was disputed.'

/** What handleChargeReversal() did, for tests and the log. */
export type ChargeReversalOutcome =
  | { kind: 'credit_pack'; result: 'revoked' | 'restored' | 'unchanged' }
  | { kind: 'subscription'; result: 'cancelled' | 'already_ended' | 'unchanged' | 'not_found' }
  | { kind: 'unmatched' }

function stripeCallError(eventType: string, step: string, chargeId: string, error: unknown): SubscriptionSyncError {
  const { type, statusCode } = (error ?? {}) as { type?: unknown; statusCode?: unknown }
  const kind = typeof type === 'string' && type ? type : 'unknown error'
  const status = typeof statusCode === 'number' ? `, status ${statusCode}` : ''
  return new SubscriptionSyncError(`Stripe webhook: ${eventType} ${step} failed (charge ${chargeId}, ${kind}${status})`)
}

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  !ref ? null : typeof ref === 'string' ? ref : ref.id

/** The charge id of a dispute or charge event's object. */
export function reversalChargeId(event: Stripe.Event): string | null {
  const object = event.data.object as { object?: string; id?: string; charge?: string | { id: string } }
  if (object.object === 'charge') return object.id ?? null
  if (object.object === 'dispute') return idOf(object.charge)
  return null
}

/**
 * Applies the current state of a charge's disputes and refunds to what it paid for. See the
 * module comment for the rules.
 */
export async function handleChargeReversal(
  supabase: ServiceRoleClient,
  eventType: string,
  chargeId: string
): Promise<ChargeReversalOutcome> {
  const charge = await retrieveCharge(eventType, chargeId)
  if (!charge) {
    console.warn(`Stripe webhook: ${eventType} matched no charge (charge ${chargeId})`)
    return { kind: 'unmatched' }
  }

  const paymentIntentId = idOf(charge.payment_intent)
  if (!paymentIntentId) {
    console.warn(`Stripe webhook: ${eventType} charge has no payment intent; nothing to do (charge ${chargeId})`)
    return { kind: 'unmatched' }
  }

  const { contested, chargeback } = await disputeState(eventType, chargeId)

  let sessions: Stripe.Checkout.Session[]
  try {
    sessions = (await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })).data
  } catch (err) {
    throw stripeCallError(eventType, 'checkout session list', chargeId, err)
  }
  const packSession = sessions.find(isCreditPackSession)
  if (packSession) {
    return { kind: 'credit_pack', result: await applyPackState(supabase, eventType, chargeId, packSession, contested || charge.refunded) }
  }

  let invoicePayments: Stripe.InvoicePayment[]
  try {
    invoicePayments = (
      await stripe.invoicePayments.list({
        payment: { type: 'payment_intent', payment_intent: paymentIntentId },
        expand: ['data.invoice'],
        limit: 10,
      })
    ).data
  } catch (err) {
    throw stripeCallError(eventType, 'invoice payment list', chargeId, err)
  }
  const subscriptionIds = [
    ...new Set(
      invoicePayments
        .map((p) => (p.invoice && typeof p.invoice === 'object' && !('deleted' in p.invoice && p.invoice.deleted)
          ? getInvoiceSubscriptionId(p.invoice as Stripe.Invoice)
          : null))
        .filter((id): id is string => Boolean(id))
    ),
  ]

  if (!subscriptionIds.length) {
    console.warn(`Stripe webhook: ${eventType} charge paid for no credit pack or subscription; nothing to do (charge ${chargeId})`)
    return { kind: 'unmatched' }
  }

  if (!chargeback) return { kind: 'subscription', result: 'unchanged' }

  let result: 'cancelled' | 'already_ended' | 'not_found' = 'not_found'
  for (const subscriptionId of subscriptionIds) {
    const outcome = await cancelDisputedSubscription(supabase, eventType, subscriptionId)
    if (outcome === 'cancelled' || (outcome === 'already_ended' && result === 'not_found')) result = outcome
  }
  return { kind: 'subscription', result }
}

/** How many times applyPackState() writes before giving up on a charge whose state keeps changing. */
const MAX_PACK_WRITES = 3

/**
 * Writes a pack's revoked state, then reads the charge again and writes once more if Stripe's
 * answer has changed meanwhile. Two events for one charge handled at the same moment can each
 * read Stripe, then write in the opposite order (the older answer last); the handler that writes
 * last always re-reads after its write, so the row ends on the state Stripe has after the last
 * write. A state that is still moving after MAX_PACK_WRITES writes throws (500, Stripe sends the
 * event again).
 */
async function applyPackState(
  supabase: ServiceRoleClient,
  eventType: string,
  chargeId: string,
  session: Stripe.Checkout.Session,
  revoke: boolean
): Promise<'revoked' | 'restored' | 'unchanged'> {
  let result: 'revoked' | 'restored' | 'unchanged' = 'unchanged'
  for (let write = 1; ; write++) {
    const written = await setCreditPackRevoked(supabase, eventType, session, revoke)
    if (written !== 'unchanged') {
      result = written
      console.warn(`Stripe webhook: ${eventType} credit pack ${written} (charge ${chargeId}, session ${session.id})`)
    }

    const charge = await retrieveCharge(eventType, chargeId)
    const now = (charge?.refunded ?? false) || (await disputeState(eventType, chargeId)).contested
    if (now === revoke) return result
    if (write >= MAX_PACK_WRITES) {
      throw new SubscriptionSyncError(
        `Stripe webhook: ${eventType} credit pack state kept changing; not settled after ${MAX_PACK_WRITES} writes (charge ${chargeId}, session ${session.id})`
      )
    }
    revoke = now
  }
}

/** The charge as Stripe has it now, or null when Stripe has no such charge. Other failures throw (500). */
async function retrieveCharge(eventType: string, chargeId: string): Promise<Stripe.Charge | null> {
  try {
    return await stripe.charges.retrieve(chargeId)
  } catch (err) {
    if (isStripeResourceMissing(err)) return null
    throw stripeCallError(eventType, 'charge retrieve', chargeId, err)
  }
}

/** Whether any dispute on the charge is contested (open or lost, inquiries included) or a chargeback. */
async function disputeState(eventType: string, chargeId: string): Promise<{ contested: boolean; chargeback: boolean }> {
  let disputes: Stripe.Dispute[]
  try {
    disputes = (await stripe.disputes.list({ charge: chargeId, limit: 100 })).data
  } catch (err) {
    throw stripeCallError(eventType, 'dispute list', chargeId, err)
  }
  return {
    contested: disputes.some((d) => CONTESTED_STATUSES.has(d.status)),
    chargeback: disputes.some((d) => CHARGEBACK_STATUSES.has(d.status)),
  }
}

/**
 * Cancels a subscription whose payment became a chargeback, at once and with Stripe's defaults
 * for a cancel (no proration, no final invoice, nothing refunded), and writes the ended state
 * to the row stored under its id (the `customer.subscription.deleted` that follows writes the
 * same). A subscription that has already ended is only written as ended.
 *
 * A subscription with a schedule attached (a downgrade waiting for the period end) is cancelled
 * the same way: measured in test mode on 2026-10-28, `subscriptions.cancel` succeeds and Stripe
 * sets the schedule's status to `canceled`, so it doesn't need releasing first.
 */
async function cancelDisputedSubscription(
  supabase: ServiceRoleClient,
  eventType: string,
  subscriptionId: string
): Promise<'cancelled' | 'already_ended' | 'not_found'> {
  const current = await retrieveCurrentSubscription(eventType, subscriptionId)
  if (!current) return 'not_found'

  const ended = current.status === 'canceled' || current.status === 'incomplete_expired'
  if (!ended) {
    try {
      await stripe.subscriptions.cancel(subscriptionId, {
        cancellation_details: { comment: DISPUTE_CANCELLATION_COMMENT },
      })
    } catch (err) {
      const { type, statusCode } = (err ?? {}) as { type?: unknown; statusCode?: unknown }
      throw new SubscriptionSyncError(
        `Stripe webhook: ${eventType} disputed subscription cancel failed (subscription ${subscriptionId}, ${typeof type === 'string' ? type : 'unknown error'}${typeof statusCode === 'number' ? `, status ${statusCode}` : ''})`
      )
    }
    console.warn(`Stripe webhook: ${eventType} subscription cancelled after a chargeback (subscription ${subscriptionId})`)
  }

  await updateSubscriptionById(supabase, eventType, subscriptionId, { status: 'canceled', tier: 'free' })
  return ended ? 'already_ended' : 'cancelled'
}
