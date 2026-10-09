import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { stripe } from '@/lib/stripe'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  STORED_SUBSCRIPTION_STATUSES,
  isEntitledSubscriptionStatus,
  type SubscriptionStatus,
} from '@tabmerger/shared'
import type Stripe from 'stripe'

/**
 * Stripe webhook receiver. Verifies the event signature, then handles subscription lifecycle
 * events (checkout completed, updated, deleted, payment failed) by syncing state to Supabase.
 * Must read the body as raw text — JSON parsing mutates bytes and breaks the HMAC signature check.
 *
 * Events after the first purchase are matched to a row by Stripe subscription id: an update
 * resolves its user through resolveSubscriptionUserId() (stored row, then subscription metadata,
 * then the customer's profile), and a cancellation or failed payment changes only the row stored
 * under that subscription id. An event that matches nothing is logged and answered with 200.
 * An update for a subscription the user's row does not track is written only while that
 * subscription is entitled; otherwise it is logged and answered with 200.
 *
 * An event only says which subscription changed. Stripe does not deliver events in order and can
 * deliver one again much later, so an update and a failed payment write the subscription's
 * current state, read from Stripe by id (retrieveCurrentSubscription()), and never the copy
 * embedded in the event. A cancellation needs no read: ending is final.
 *
 * What the status code tells Stripe:
 * - 200: the event was recorded, or there is nothing to record (no row or user matches it, Stripe
 *   has no such subscription, the event type is not handled, a credit pack was already granted).
 *   Stripe does not send it again.
 * - 500: a database read or write failed while the event was being recorded, or the subscription
 *   could not be read from Stripe. Stripe delivers the event again: every handler here can run
 *   again for the same event with the same result, and the events of one subscription leave
 *   the same row in whatever order they arrive.
 *
 * A row's status is always one the database stores: see toStoredState().
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    )
  }

  // Service role required — webhook runs with no user session, so anon client has no RLS identity to satisfy
  const supabase = await createServiceRoleClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        if (session.mode === 'payment') {
          if (session.metadata?.type === 'ai_credit_pack') {
            await creditAiCreditPack(supabase, session)
          }
          break
        }

        if (session.mode !== 'subscription') break

        const sessionSubscriptionId = session.subscription as string
        const subscription = await retrieveCurrentSubscription(event.type, sessionSubscriptionId)

        // A completed checkout always has its subscription; not finding it is a failure (500).
        if (!subscription) {
          throw new WebhookRetryError(
            `Stripe webhook: ${event.type} subscription not found at Stripe (subscription ${sessionSubscriptionId})`
          )
        }

        const customerId = session.customer as string

        // Resolve the Supabase user ID from most-reliable to least-reliable source:
        // 1. subscription.metadata.user_id — set via subscription_data.metadata in createCheckoutSession
        // 2. session.metadata.user_id     — set via top-level metadata in createCheckoutSession
        // 3. profile lookup by stripe_customer_id — handles legacy/returning customers
        let resolvedUserId =
          subscription.metadata?.user_id ?? session.metadata?.user_id ?? null

        if (!resolvedUserId) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single()

          // `.single()` reports "no such row" as PGRST116: that is an event with no user (200,
          // below). Any other error means the lookup itself did not run.
          if (profileError && profileError.code !== NO_SINGLE_ROW) {
            throw databaseError(event.type, 'profile lookup', `subscription ${subscription.id}`, profileError)
          }

          if (!profile) {
            console.error(
              'checkout.session.completed: cannot resolve user for Stripe customer',
              customerId
            )
            break
          }

          resolvedUserId = profile.id
        }

        // Keep the customer ID on the profile: the billing portal routes open the portal for
        // it, and it is the last key resolveSubscriptionUserId() tries for later events.
        const { error: customerLinkError } = await supabase
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', resolvedUserId)

        // The plan is written before a failed customer-id write is reported, so the purchase
        // is in place while Stripe sends the event again to store the customer id.
        await upsertSubscription(supabase, event.type, subscription, resolvedUserId)

        if (customerLinkError) {
          throw databaseError(
            event.type,
            'profile customer id update',
            `subscription ${subscription.id}`,
            customerLinkError,
            { withMessage: true }
          )
        }

        await trackCheckoutCompleted(subscription, resolvedUserId)

        break
      }

      case 'customer.subscription.updated': {
        // The event says which subscription changed; what is written is that subscription's
        // current state at Stripe, never the copy embedded in the event.
        const subscriptionId = (event.data.object as Stripe.Subscription).id
        const subscription = await retrieveCurrentSubscription(event.type, subscriptionId)

        if (!subscription) {
          logUnmatchedEvent(event.type, subscriptionId)
          break
        }

        const owner = await resolveSubscriptionUserId(supabase, event.type, subscription)

        if (!owner) {
          logUnmatchedEvent(event.type, subscriptionId)
          break
        }

        // The upsert rewrites the user's one row. A subscription that row does not track yet
        // (the user was found through metadata or the profile, not the stored row) may take the
        // row over only while it is entitled: a new plan can start this way, but an ended or
        // unpaid subscription never replaces whatever the row holds now.
        if (owner.via !== 'stored_row' && !isEntitledSubscriptionStatus(subscription.status)) {
          logNotOnRecordEvent(event.type, subscriptionId, subscription.status)
          break
        }

        await upsertSubscription(supabase, event.type, subscription, owner.userId)
        break
      }

      case 'customer.subscription.deleted': {
        // A cancellation is applied by subscription id: the row stored under this Stripe
        // subscription is the one that ends, whichever customer the event names. Ending is
        // final at Stripe (a canceled subscription never becomes active again), so this needs
        // no read of the current state: it is correct whenever and however often it arrives.
        const subscription = event.data.object as Stripe.Subscription
        await updateSubscriptionById(supabase, event.type, subscription.id, {
          status: 'canceled',
          tier: 'free',
        })
        break
      }

      case 'invoice.payment_failed': {
        // A failed payment updates the row stored under the invoice's subscription id with the
        // status that subscription has at Stripe now (`past_due` while Stripe retries the
        // payment; whatever it has become since, when the event arrives late). An invoice with
        // no subscription (or for a subscription no row tracks) changes nothing.
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = getInvoiceSubscriptionId(invoice)

        if (!subscriptionId) {
          logUnmatchedEvent(event.type, null)
          break
        }

        const subscription = await retrieveCurrentSubscription(event.type, subscriptionId)

        if (!subscription) {
          logUnmatchedEvent(event.type, subscriptionId)
          break
        }

        await updateSubscriptionById(supabase, event.type, subscriptionId, {
          status: subscription.status,
        })
        break
      }

      default:
        // Unhandled event type
        break
    }
  } catch (err) {
    // A WebhookRetryError's message is already the complete, payload-free log line.
    if (err instanceof WebhookRetryError) {
      console.error(err.message)
    } else {
      console.error('Webhook handler error:', err)
    }
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ received: true })
}

type ServiceRoleClient = Awaited<ReturnType<typeof createServiceRoleClient>>

/** The shape of a Supabase user id. A metadata value of any other shape is never used as a key. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PostgREST's code for `.single()` finding no row (or more than one): a miss, not a failure. */
const NO_SINGLE_ROW = 'PGRST116'

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * The event could not be recorded this time: a database read or write failed, or Stripe's current
 * state of the subscription could not be read. Throwing it makes the handler answer 500, so
 * Stripe delivers the event again instead of treating it as done. Build it with databaseError()
 * or stripeRetrieveError(): the message is the whole log line.
 */
class WebhookRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebhookRetryError'
  }
}

/** Stripe's error code for an object that does not exist in this account and mode (HTTP 404). */
const STRIPE_RESOURCE_MISSING = 'resource_missing'

/**
 * The error to throw when the subscription could not be retrieved from Stripe (network, a 5xx,
 * a rate limit, a rejected key). Its message holds the event type, the subscription id, and the
 * Stripe error's type and HTTP status; never the error object, which carries request headers.
 */
function stripeRetrieveError(
  eventType: string,
  subscriptionId: string,
  error: unknown
): WebhookRetryError {
  const { type, statusCode } = (error ?? {}) as { type?: unknown; statusCode?: unknown }
  const kind = typeof type === 'string' && type ? type : 'unknown error'
  const status = typeof statusCode === 'number' ? `, status ${statusCode}` : ''
  return new WebhookRetryError(
    `Stripe webhook: ${eventType} subscription retrieve failed (subscription ${subscriptionId}, ${kind}${status})`
  )
}

/**
 * The subscription as Stripe has it now, read by id. Events are not delivered in order and can be
 * delivered again much later, so the object embedded in an event may be older than what the row
 * already holds; the handlers write this current state instead, which makes the order of delivery
 * irrelevant. A subscription that has ended is still returned, with status `canceled`.
 *
 * - Returns null when Stripe has no subscription with that id (`resource_missing`).
 * - Throws a WebhookRetryError (500) for any other failure, and when the object returned is not
 *   the subscription that was asked for. The event's embedded object is never used in its place.
 */
async function retrieveCurrentSubscription(
  eventType: string,
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  let subscription: Stripe.Subscription

  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId)
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === STRIPE_RESOURCE_MISSING) return null
    throw stripeRetrieveError(eventType, subscriptionId, err)
  }

  // The id in the event stays the key: an answer about any other subscription is not written.
  if (subscription?.id !== subscriptionId) {
    throw new WebhookRetryError(
      `Stripe webhook: ${eventType} retrieved a subscription other than the one asked for; nothing is written (subscription ${subscriptionId})`
    )
  }

  return subscription
}

/**
 * The error to throw for a failed database call. Its message holds the event type, the step, the
 * subscription or session id, and the database error code; `withMessage` adds the database's own
 * message, for writes. Never the error object itself (its `details` can quote a row), the event
 * payload, metadata or an email.
 */
function databaseError(
  eventType: string,
  step: string,
  reference: string,
  error: { code?: string; message?: string },
  { withMessage = false }: { withMessage?: boolean } = {}
): WebhookRetryError {
  const code = error.code || 'unknown'
  const detail = withMessage && error.message ? `: ${error.message}` : ''
  return new WebhookRetryError(
    `Stripe webhook: ${eventType} ${step} failed (${reference}, code ${code})${detail}`
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
function toStoredState<T extends string | undefined>(
  eventType: string,
  subscriptionId: string,
  status: string,
  tier: T
): { status: SubscriptionStatus; tier: T | 'free' } {
  if (status === ENDED_STATUS) return { status: ENDED_STATUS, tier: 'free' }

  if ((STORED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
    return { status: status as SubscriptionStatus, tier }
  }

  console.warn(
    `Stripe webhook: ${eventType} status ${status} is not a stored status; the row is written as ${ENDED_STATUS} (subscription ${subscriptionId})`
  )
  return { status: ENDED_STATUS, tier: 'free' }
}

/**
 * One line for an event that matched no subscription row and no user. The handler answers 200
 * (sending the event again would match nothing either), so this line is how it is found afterwards.
 * Logs the event type and the subscription id only: never the payload, metadata or an email.
 */
function logUnmatchedEvent(eventType: string, subscriptionId: string | null) {
  console.warn(
    `Stripe webhook: ${eventType} matched no subscription row or user (subscription ${subscriptionId ?? 'none'})`
  )
}

/**
 * One line for an event about a subscription that is not the one on the user's row and that is
 * not entitled, so it may not replace what the row tracks. Nothing is written and the handler
 * answers 200. Logs the event type, the subscription id and its status at Stripe only.
 */
function logNotOnRecordEvent(eventType: string, subscriptionId: string, status: string) {
  console.warn(
    `Stripe webhook: ${eventType} ignored: the subscription is not the one on record and its status is ${status} (subscription ${subscriptionId})`
  )
}

/** The user a subscription belongs to, and which key of resolveSubscriptionUserId() found it. */
type ResolvedSubscriptionUser = {
  userId: string
  via: 'stored_row' | 'metadata' | 'profile'
}

/**
 * Resolves the user a subscription event belongs to. The keys are tried in this order and the
 * first one that resolves wins; a later key never overrides an earlier one:
 *
 * 1. The row already stored under this Stripe subscription id: its `user_id` is the owner.
 * 2. `subscription.metadata.user_id`, stamped server-side by `createCheckoutSession`: used only
 *    when no row holds this subscription id yet, and only if it has the shape of a user id and
 *    a profile with that id exists.
 * 3. The profile whose `stripe_customer_id` is the subscription's customer.
 *
 * Returns the user and the key that resolved it (`via`), or null when none resolve. `via` is
 * `'stored_row'` only when the user's row already tracks this subscription; the caller uses it to
 * decide whether the subscription may take over a row that tracks something else. A lookup that
 * fails is not a miss: it throws a WebhookRetryError (500, Stripe sends the event again), so a
 * weaker key is never tried in place of a key that could not be read.
 */
async function resolveSubscriptionUserId(
  supabase: ServiceRoleClient,
  eventType: string,
  subscription: Stripe.Subscription
): Promise<ResolvedSubscriptionUser | null> {
  const metadataUserId = subscription.metadata?.user_id
  const reference = `subscription ${subscription.id}`

  const { data: row, error: rowError } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('id', subscription.id)
    .maybeSingle()

  if (rowError) throw databaseError(eventType, 'subscription lookup', reference, rowError)

  if (row?.user_id) {
    if (metadataUserId && metadataUserId !== row.user_id) {
      console.warn(
        `Stripe webhook: ${eventType} metadata names a different user than the stored row; the stored row is used (subscription ${subscription.id})`
      )
    }
    return { userId: row.user_id, via: 'stored_row' }
  }

  if (metadataUserId && UUID_PATTERN.test(metadataUserId)) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', metadataUserId)
      .maybeSingle()

    if (profileError) {
      throw databaseError(eventType, 'metadata profile lookup', reference, profileError)
    }
    if (profile?.id) return { userId: profile.id, via: 'metadata' }
  }

  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id

  if (customerId) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle()

    if (profileError) {
      throw databaseError(eventType, 'customer profile lookup', reference, profileError)
    }
    if (profile?.id) return { userId: profile.id, via: 'profile' }
  }

  return null
}

/**
 * Applies `changes` to the row stored under a Stripe subscription id, and to no other row.
 * Used by the events that end or flag a plan, which need no user lookup at all: the subscription
 * id is the key. The status goes through toStoredState() like every other write.
 *
 * No matching row is logged and left at that (200). A database error throws a
 * WebhookRetryError (500): the same update runs again when Stripe redelivers, and applying it
 * twice leaves the row as applying it once does.
 */
async function updateSubscriptionById(
  supabase: ServiceRoleClient,
  eventType: string,
  subscriptionId: string,
  changes: { status: string; tier?: string }
) {
  const stored = toStoredState(eventType, subscriptionId, changes.status, changes.tier)

  const { data: rows, error } = await supabase
    .from('subscriptions')
    .update(stored.tier === undefined ? { status: stored.status } : stored)
    .eq('id', subscriptionId)
    .select('id')

  if (error) {
    throw databaseError(eventType, 'update', `subscription ${subscriptionId}`, error, {
      withMessage: true,
    })
  }

  if (!rows?.length) logUnmatchedEvent(eventType, subscriptionId)
}

/**
 * The id of the subscription an invoice bills, or null for an invoice that bills none.
 * The event payload follows the API version of the webhook endpoint, not of this SDK client:
 * current versions carry it under `parent.subscription_details`, earlier ones as a top-level
 * `subscription`. Both are read so the handler works whichever version the endpoint was made on.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null })
    .subscription
  const reference = invoice.parent?.subscription_details?.subscription ?? legacy

  if (!reference) return null
  return typeof reference === 'string' ? reference : reference.id
}

/**
 * Grants a one-time AI credit pack purchase. Idempotent on stripe_checkout_session_id
 * (unique constraint on ai_credit_purchases) — Stripe can redeliver checkout.session.completed,
 * and a duplicate insert must be a no-op, not a double credit. Any other insert error throws a
 * WebhookRetryError (500), so the event is delivered again and the pack is granted then.
 */
async function creditAiCreditPack(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  session: Stripe.Checkout.Session
) {
  const userId = session.metadata?.user_id
  if (!userId) {
    console.error('ai_credit_pack checkout.session.completed missing user_id metadata', session.id)
    return
  }

  const month = new Date().toISOString().slice(0, 7)

  // session.line_items isn't populated unless expanded at creation time, so pull the
  // actual purchased quantity back from Stripe rather than assuming a fixed amount.
  // quantity is already a per-call count (not a pack multiplier) since the price is per-call.
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 })
  const quantity = lineItems.data[0]?.quantity ?? 1

  const { error } = await supabase.from('ai_credit_purchases').insert({
    user_id: userId,
    month,
    credits: quantity,
    stripe_checkout_session_id: session.id,
  })

  // Unique violation on stripe_checkout_session_id = already credited this event, not an error.
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw databaseError('checkout.session.completed', 'credit pack insert', `session ${session.id}`, error, {
      withMessage: true,
    })
  }
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
 * is written as canceled / free.
 *
 * A database error throws a WebhookRetryError (500, Stripe sends the event again). Running
 * twice for one event is safe: the conflict target is user_id, so the second run rewrites the
 * same row with the same values.
 */
async function upsertSubscription(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  eventType: string,
  subscription: Stripe.Subscription,
  userId: string
) {
  const priceId = subscription.items.data[0]?.price.id
  const { status, tier } = toStoredState(
    eventType,
    subscription.id,
    subscription.status,
    getTierFromPriceId(priceId)
  )

  const { error } = await supabase.from('subscriptions').upsert(
    {
      id: subscription.id,
      user_id: userId,
      tier,
      status,
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
}

/**
 * Maps a Stripe price ID to the internal tier name ('pro', 'pro_ai', or 'free').
 * Price IDs are read from env vars so they work across test and live Stripe environments.
 */
function getTierFromPriceId(priceId: string | undefined): string {
  return getTierAndBilling(priceId).tier
}

/**
 * Maps a Stripe price ID to both tier and billing period, from the same env-var mapping
 * used by getTierFromPriceId. Shared by upsertSubscription and the GA4 checkout_completed event
 * so tier/billing logic is never duplicated.
 */
function getTierAndBilling(priceId: string | undefined): {
  tier: string
  billing: 'monthly' | 'yearly' | null
} {
  if (!priceId) return { tier: 'free', billing: null }

  const proMonthly = process.env.STRIPE_PRO_MONTHLY_PRICE_ID
  const proYearly = process.env.STRIPE_PRO_YEARLY_PRICE_ID
  const proAiMonthly = process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID
  const proAiYearly = process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID

  if (priceId === proMonthly) return { tier: 'pro', billing: 'monthly' }
  if (priceId === proYearly) return { tier: 'pro', billing: 'yearly' }
  if (priceId === proAiMonthly) return { tier: 'pro_ai', billing: 'monthly' }
  if (priceId === proAiYearly) return { tier: 'pro_ai', billing: 'yearly' }
  return { tier: 'free', billing: null }
}

/**
 * Fires a GA4 Measurement Protocol `checkout_completed` event server-side, since checkout
 * success can happen via redirect where the client-side page load isn't a reliable "did the
 * payment actually succeed" signal — this webhook, post signature-verification, is the source
 * of truth. Never throws: a GA outage must not affect the Stripe webhook's response.
 * client_id is a SHA-256 hash of the Supabase user ID (not the raw Stripe customer ID) so GA
 * never receives a reversible identifier, while still being stable per-user across events.
 */
async function trackCheckoutCompleted(subscription: Stripe.Subscription, userId: string) {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const apiSecret = process.env.GA_API_SECRET
  if (!measurementId || !apiSecret) return // ponytail: no-op if not configured

  try {
    const item = subscription.items.data[0]
    const priceId = item?.price.id
    const { tier, billing } = getTierAndBilling(priceId)
    if (tier === 'free' || !billing) return

    const clientId = createHash('sha256').update(userId).digest('hex')
    const value = (item?.price.unit_amount ?? 0) / 100

    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [{ name: 'checkout_completed', params: { tier, value, currency: 'usd', billing } }],
        }),
      }
    )
  } catch (err) {
    console.error('GA4 checkout_completed tracking failed:', err)
  }
}
