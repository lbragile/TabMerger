import type Stripe from 'stripe'
import {
  STORED_SUBSCRIPTION_STATUSES,
  isEntitledSubscriptionStatus,
  type SubscriptionStatus,
} from '@tabmerger/shared'
import { stripe } from '@/lib/stripe'
import type { createServiceRoleClient } from '@/lib/supabase/server'
import { SUBSCRIPTION_EXPAND, subscriptionAiColumns, type AiColumns } from '@/lib/aiAllowance'
import { getPlanForPriceId, type PlanPrice } from '@/lib/tiers'

/**
 * How a `subscriptions` row is brought in line with Stripe: read the subscription's current state
 * by id, map its status to one the database stores, and write it to the row stored under that id.
 * The Stripe webhook (app/api/webhooks/stripe/route.ts) is the main caller; the plan switch
 * (lib/planSwitch.ts) uses the same steps through resyncEndedSubscription() when a row still shows
 * a plan that Stripe says has ended.
 *
 * `source` names the caller in every log line: a Stripe event type (`Stripe webhook: <type> ...`)
 * or the plan switch's resync (`Plan switch resync: ...`).
 */

export type ServiceRoleClient = Awaited<ReturnType<typeof createServiceRoleClient>>

/** The `source` of resyncEndedSubscription()'s calls. */
const PLAN_SWITCH_RESYNC = 'plan switch resync'
/** The `source` of recordLiveSubscription()'s calls. */
const CHECKOUT_RESYNC = 'checkout resync'

/** The start of a log line: the webhook's event type, the plan switch's or the checkout's resync. */
function logLabel(source: string): string {
  if (source === PLAN_SWITCH_RESYNC) return 'Plan switch resync:'
  if (source === CHECKOUT_RESYNC) return 'Checkout resync:'
  return `Stripe webhook: ${source}`
}

/**
 * A subscription could not be synced this time: a database read or write failed, or Stripe's
 * current state of the subscription could not be read. The webhook answers 500 for it, so Stripe
 * delivers the event again instead of treating it as done; the plan switch answers 500. Build it
 * with databaseError() or stripeRetrieveError(): the message is the whole log line.
 */
export class SubscriptionSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubscriptionSyncError'
  }
}

/** Stripe's error code for an object that does not exist in this account and mode (HTTP 404). */
export const STRIPE_RESOURCE_MISSING = 'resource_missing'

/** True for a Stripe SDK error saying the object doesn't exist in this account and mode. */
export function isStripeResourceMissing(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === STRIPE_RESOURCE_MISSING
}

/**
 * The error to throw when the subscription could not be retrieved from Stripe (network, a 5xx,
 * a rate limit, a rejected key). Its message holds the source, the subscription id, and the
 * Stripe error's type and HTTP status; never the error object, which carries request headers.
 */
export function stripeRetrieveError(
  source: string,
  subscriptionId: string,
  error: unknown,
  what: 'subscription' | 'coupon' = 'subscription'
): SubscriptionSyncError {
  const { type, statusCode } = (error ?? {}) as { type?: unknown; statusCode?: unknown }
  const kind = typeof type === 'string' && type ? type : 'unknown error'
  const status = typeof statusCode === 'number' ? `, status ${statusCode}` : ''
  return new SubscriptionSyncError(
    `${logLabel(source)} ${what} retrieve failed (subscription ${subscriptionId}, ${kind}${status})`
  )
}

/**
 * The subscription as Stripe has it now, read by id. Events are not delivered in order and can be
 * delivered again much later, so the object embedded in an event may be older than what the row
 * already holds; the handlers write this current state instead, which makes the order of delivery
 * irrelevant. A subscription that has ended is still returned, with status `canceled`.
 *
 * - Returns null when Stripe has no subscription with that id (`resource_missing`).
 * - Throws a SubscriptionSyncError (500) for any other failure, and when the object returned is
 *   not the subscription that was asked for. The event's embedded object is never used in its place.
 */
export async function retrieveCurrentSubscription(
  source: string,
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  let subscription: Stripe.Subscription

  try {
    // Expanded with what subscriptionAiColumns() prices the managed AI allowance from.
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: [...SUBSCRIPTION_EXPAND],
    })
  } catch (err) {
    if (isStripeResourceMissing(err)) return null
    throw stripeRetrieveError(source, subscriptionId, err)
  }

  // The id asked for stays the key: an answer about any other subscription is not written.
  if (subscription?.id !== subscriptionId) {
    throw new SubscriptionSyncError(
      `${logLabel(source)} retrieved a subscription other than the one asked for; nothing is written (subscription ${subscriptionId})`
    )
  }

  return subscription
}

/**
 * The error to throw for a failed database call. Its message holds the source, the step, the
 * subscription or session id, and the database error code; `withMessage` adds the database's own
 * message, for writes. Never the error object itself (its `details` can quote a row), the event
 * payload, metadata or an email.
 */
export function databaseError(
  source: string,
  step: string,
  reference: string,
  error: { code?: string; message?: string },
  { withMessage = false }: { withMessage?: boolean } = {}
): SubscriptionSyncError {
  const code = error.code || 'unknown'
  const detail = withMessage && error.message ? `: ${error.message}` : ''
  return new SubscriptionSyncError(
    `${logLabel(source)} ${step} failed (${reference}, code ${code})${detail}`
  )
}

/**
 * The status of a plan that has ended. Also what a status outside STORED_SUBSCRIPTION_STATUSES is
 * written as: it is stored, and it is never entitled.
 */
const ENDED_STATUS: SubscriptionStatus = 'canceled'

/**
 * The status and tier a row is written with. Every write of `subscriptions.status` goes through
 * here, so a row only ever holds a status the database stores (STORED_SUBSCRIPTION_STATUSES), and
 * an ended plan looks the same whichever event reported it:
 *
 * - `canceled` is always written with tier `free`. The status alone ends the entitlement; the
 *   tier follows it so the row is the same after a `customer.subscription.deleted` event and
 *   after any other event that finds the subscription canceled.
 * - Any other stored status is written as is, with the tier the caller passed.
 * - A status that is not stored (Stripe's `unpaid`, `paused`, `incomplete_expired`, or one it
 *   adds later) ends the plan the same way: status `canceled`, tier `free`. A later event that
 *   finds a stored status writes the plan back.
 */
export function toStoredState<T extends string | undefined>(
  source: string,
  subscriptionId: string,
  status: string,
  tier: T
): { status: SubscriptionStatus; tier: T | 'free' } {
  if (status === ENDED_STATUS) return { status: ENDED_STATUS, tier: 'free' }

  if ((STORED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
    return { status: status as SubscriptionStatus, tier }
  }

  console.warn(
    `${logLabel(source)} status ${status} is not a stored status; the row is written as ${ENDED_STATUS} (subscription ${subscriptionId})`
  )
  return { status: ENDED_STATUS, tier: 'free' }
}

/**
 * One line for an event that matched no subscription row and no user. The handler answers 200
 * (sending the event again would match nothing either), so this line is how it is found afterwards.
 * Logs the source and the subscription id only: never the payload, metadata or an email.
 */
export function logUnmatchedEvent(source: string, subscriptionId: string | null) {
  console.warn(
    `${logLabel(source)} matched no subscription row or user (subscription ${subscriptionId ?? 'none'})`
  )
}

/**
 * Applies `changes` to the row stored under a Stripe subscription id, and to no other row.
 * Used by the events that end or flag a plan, which need no user lookup at all: the subscription
 * id is the key. The status goes through toStoredState() like every other write.
 *
 * Returns what was written, or null when no row is stored under that id (logged; the webhook
 * answers 200). A database error throws a SubscriptionSyncError (500): the same update runs again
 * when Stripe redelivers, and applying it twice leaves the row as applying it once does.
 */
export async function updateSubscriptionById(
  supabase: ServiceRoleClient,
  source: string,
  subscriptionId: string,
  changes: { status: string; tier?: string }
): Promise<{ status: SubscriptionStatus; tier: string | undefined } | null> {
  const stored = toStoredState(source, subscriptionId, changes.status, changes.tier)

  // An ended plan has no managed AI allowance; the AI option is left as it was.
  const { data: rows, error } = await supabase
    .from('subscriptions')
    .update(
      stored.tier === undefined
        ? { status: stored.status }
        : stored.tier === 'free'
          ? { ...stored, ai_monthly_credits: 0 }
          : stored
    )
    .eq('id', subscriptionId)
    .select('id')

  if (error) {
    throw databaseError(source, 'update', `subscription ${subscriptionId}`, error, {
      withMessage: true,
    })
  }

  if (!rows?.length) {
    logUnmatchedEvent(source, subscriptionId)
    return null
  }
  return stored
}

/** What resyncEndedSubscription() did. */
export type EndedSubscriptionResync =
  | { corrected: true; status: SubscriptionStatus; tier: string }
  | {
      corrected: false
      /**
       * - `not_found`: Stripe has no subscription with that id (the row is left as it is: a key for
       *   the wrong account or mode would look the same, and must never end real plans);
       * - `other_customer`: the subscription belongs to another Stripe customer;
       * - `entitled`: Stripe says the subscription is live, so there is nothing to correct;
       * - `no_row`: no row is stored under that id any more (a newer subscription took it over).
       */
      reason: 'not_found' | 'other_customer' | 'entitled' | 'no_row'
    }

/**
 * Brings the row stored under `subscriptionId` back in line with Stripe when Stripe says that
 * subscription has ended but the row still shows the plan (a missed or failed webhook delivery).
 * The caller has already found that `customerId` has no entitled subscription at Stripe.
 *
 * The same steps as the webhook: the subscription's current state is retrieved from Stripe, its
 * status goes through toStoredState() (canceled, or any status the database doesn't store, is
 * written as canceled) and is written by updateSubscriptionById(), always with tier `free` and no
 * managed AI allowance: a status that isn't entitled gets nothing, whatever the price. (The
 * webhook keeps the price's tier for a stored, non-entitled status such as `incomplete`; access
 * is the same either way, as entitlement reads the status.)
 * The write is keyed on the subscription id rather than the user, so if a new checkout has just
 * replaced the row with a new subscription, nothing is written over it.
 *
 * Only ever ends or lowers a row: nothing is written unless the subscription belongs to
 * `customerId` and its status at Stripe is not entitled. A failed Stripe read or database write
 * throws a SubscriptionSyncError.
 */
export async function resyncEndedSubscription(
  supabase: ServiceRoleClient,
  subscriptionId: string,
  customerId: string
): Promise<EndedSubscriptionResync> {
  const subscription = await retrieveCurrentSubscription(PLAN_SWITCH_RESYNC, subscriptionId)
  if (!subscription) return { corrected: false, reason: 'not_found' }

  const owner =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
  if (owner !== customerId) return { corrected: false, reason: 'other_customer' }
  if (isEntitledSubscriptionStatus(subscription.status)) return { corrected: false, reason: 'entitled' }

  const written = await updateSubscriptionById(supabase, PLAN_SWITCH_RESYNC, subscriptionId, {
    status: subscription.status,
    tier: 'free',
  })
  if (!written) return { corrected: false, reason: 'no_row' }
  return { corrected: true, status: written.status, tier: written.tier ?? 'free' }
}

/**
 * Writes or updates a subscription row keyed on user_id (one row per user, enforced by the
 * subscriptions_user_id_key UNIQUE constraint from migration 012).
 *
 * The conflict target is user_id, NOT id: every user already has a subscription row created by
 * the handle_new_user() signup trigger with id = 'free_<uuid>'. On a first purchase the Stripe
 * subscription id is brand new, so an onConflict:'id' upsert would attempt an INSERT that
 * violates the user_id UNIQUE constraint (Postgres 23505). Conflicting on user_id instead rewrites
 * that existing row in place: its id becomes the Stripe subscription id and tier/status/period are
 * updated. It also still handles the genuine insert case (no row for the user) since upsert
 * covers both.
 *
 * Derives the app tier from the price ID via env-var mapping; defaults to 'free' on unknown prices.
 * The status and tier then go through toStoredState(), so a status the database does not store
 * is written as canceled / free. `ai_mode` and `ai_monthly_credits` come from aiColumns().
 *
 * The write `checkout.session.completed` and `customer.subscription.updated` make; the checkout's
 * Stripe check (recordLiveSubscription()) makes the same one.
 *
 * A database error throws a SubscriptionSyncError (500, Stripe sends the event again). Running
 * twice for one event is safe: the conflict target is user_id, so the second run rewrites the
 * same row with the same values.
 */
export async function upsertSubscription(
  supabase: ServiceRoleClient,
  eventType: string,
  subscription: Stripe.Subscription,
  userId: string
): Promise<{ tier: string; status: SubscriptionStatus }> {
  const priceId = subscription.items.data[0]?.price.id
  const plan = getPlanForPriceId(priceId)
  const { status, tier } = toStoredState(
    eventType,
    subscription.id,
    subscription.status,
    plan?.tier ?? 'free'
  )
  const ai = await aiColumns(eventType, subscription, plan, tier)

  const { error } = await supabase.from('subscriptions').upsert(
    {
      id: subscription.id,
      user_id: userId,
      tier,
      status,
      ai_mode: ai.aiMode,
      ai_monthly_credits: ai.monthlyCredits,
      stripe_price_id: priceId,
      cancel_at_period_end: subscription.cancel_at_period_end,
      // ponytail: Stripe v22 moved current_period_end from Subscription to SubscriptionItem
      current_period_end: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) {
    throw databaseError(eventType, 'upsert', `subscription ${subscription.id}`, error, {
      withMessage: true,
    })
  }
  return { tier, status }
}

/**
 * The `ai_mode` and `ai_monthly_credits` to write for a subscription: subscriptionAiColumns() from
 * lib/aiAllowance.ts (the same function the re-sync script uses). A coupon that has to be read
 * from Stripe and can't be (other than "no such coupon") throws a SubscriptionSyncError (500), so the
 * event is delivered again rather than written with a guessed allowance.
 */
function aiColumns(
  eventType: string,
  subscription: Stripe.Subscription,
  plan: PlanPrice | null,
  storedTier: string
): Promise<AiColumns> {
  return subscriptionAiColumns(subscription, plan, storedTier, {
    retrieveCoupon: async (id) => {
      try {
        return await stripe.coupons.retrieve(id)
      } catch (err) {
        if (isStripeResourceMissing(err)) return null
        throw stripeRetrieveError(eventType, subscription.id, err, 'coupon')
      }
    },
    onUnpriceableDiscount: (reason) =>
      console.warn(
        `${logLabel(eventType)} a discount can't be priced in USD (${reason}); managed AI credits are written as 0 (subscription ${subscription.id})`
      ),
  })
}

/** What recordLiveSubscription() did. */
export type LiveSubscriptionRecord =
  | { recorded: true; tier: string; status: SubscriptionStatus }
  | {
      recorded: false
      /**
       * - `not_found`: Stripe has no subscription with that id any more;
       * - `other_customer`: it belongs to another Stripe customer;
       * - `not_entitled`: it is no longer live at Stripe;
       * - `unknown_price`: its price isn't one this deployment sells (or it has several items), so
       *   no tier can be read from it;
       * - `other_user`: its metadata names another account.
       */
      reason: 'not_found' | 'other_customer' | 'not_entitled' | 'unknown_price' | 'other_user'
    }

/**
 * Writes a live subscription Stripe has for the account's customer to the account's row, when the
 * row doesn't show it (a missed `checkout.session.completed` or `customer.subscription.updated`).
 * Used by `/api/checkout`, which has just found the subscription in the customer's list and
 * refuses the new checkout either way.
 *
 * The subscription is read again by id (retrieveCurrentSubscription(), with what the AI allowance
 * is priced from) and written with upsertSubscription(), the webhook's own write, only when it
 * belongs to `customerId`, is entitled, is on a single price this deployment knows, and its
 * metadata names no other user. It is then read once more, and a plan that ended in between is
 * written back down (free, by subscription id). A failed Stripe read or database write throws a
 * SubscriptionSyncError.
 */
export async function recordLiveSubscription(
  supabase: ServiceRoleClient,
  subscriptionId: string,
  customerId: string,
  userId: string
): Promise<LiveSubscriptionRecord> {
  const subscription = await retrieveCurrentSubscription(CHECKOUT_RESYNC, subscriptionId)
  if (!subscription) return { recorded: false, reason: 'not_found' }

  const owner =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
  if (owner !== customerId) return { recorded: false, reason: 'other_customer' }
  if (!isEntitledSubscriptionStatus(subscription.status)) return { recorded: false, reason: 'not_entitled' }
  const items = subscription.items?.data ?? []
  if (items.length !== 1 || !getPlanForPriceId(items[0]?.price?.id)) {
    return { recorded: false, reason: 'unknown_price' }
  }
  const metadataUserId = subscription.metadata?.user_id
  if (metadataUserId && metadataUserId !== userId) return { recorded: false, reason: 'other_user' }

  const written = await upsertSubscription(supabase, CHECKOUT_RESYNC, subscription, userId)

  // A `customer.subscription.deleted` handled between the read above and the upsert matched no row
  // (the row still had its old id), so the upsert may have brought back a plan that has ended.
  // Read it once more: if it isn't live any more, end the row under this id, downward only, as
  // resyncEndedSubscription() does (a subscription Stripe no longer has counts as ended).
  const after = await retrieveCurrentSubscription(CHECKOUT_RESYNC, subscriptionId)
  if (!after || !isEntitledSubscriptionStatus(after.status)) {
    await updateSubscriptionById(supabase, CHECKOUT_RESYNC, subscriptionId, {
      status: after?.status ?? 'canceled',
      tier: 'free',
    })
    return { recorded: false, reason: 'not_entitled' }
  }
  return { recorded: true, ...written }
}
