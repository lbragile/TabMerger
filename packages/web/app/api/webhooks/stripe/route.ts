import { NextResponse, after, type NextRequest } from 'next/server'
import { createHmac, randomUUID } from 'crypto'
import { stripe } from '@/lib/stripe'
import { createServiceRoleClient } from '@/lib/supabase/server'
import {
  ANALYTICS_EVENTS,
  creditsForPayment,
  isAiMode,
  isEntitledSubscriptionStatus,
  type AiMode,
} from '@tabmerger/shared'
import { gaEnvironment, sendGa4Event, type Ga4Params } from '@/lib/ga4'
import {
  CHECKOUT_CURRENCY,
  CHECKOUT_INTERVALS,
  CHECKOUT_TIERS,
  analyticsItem,
  analyticsTier,
  checkoutValue,
  type CheckoutInterval,
  type CheckoutTier,
} from '@/lib/checkoutAnalytics'
import { getPlanForPriceId } from '@/lib/tiers'
import {
  SubscriptionSyncError,
  databaseError,
  logUnmatchedEvent,
  retrieveCurrentSubscription,
  updateSubscriptionById,
  upsertSubscription,
  type ServiceRoleClient,
} from '@/lib/subscriptionSync'
import type Stripe from 'stripe'

/**
 * Stripe webhook receiver. Verifies the event signature, then handles subscription lifecycle
 * events (checkout completed, updated, deleted, payment failed) by syncing state to Supabase.
 * `checkout.session.expired` writes nothing: it only reports a `checkout_abandoned` analytics
 * event (see trackCheckoutAbandoned()) and always answers 200.
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
 * A row's status is always one the database stores: see toStoredState(). The retrieve, stored-state,
 * update-by-id and upsert steps live in lib/subscriptionSync.ts, shared with the plan switch's
 * resync and the checkout's Stripe check.
 *
 * Every subscription write also stores the Pro AI option (`ai_mode`, from the price) and the
 * managed AI allowance (`ai_monthly_credits`, see subscriptionAiColumns() in lib/aiAllowance.ts):
 * what the subscription actually pays, after discounts, turned into credits. Discount events
 * (`customer.discount.*`) read the subscription again so the allowance follows a coupon that is
 * added, changed or ends. A credit pack grants creditsForPayment() of the USD amount paid.
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
          throw new SubscriptionSyncError(
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

        // After the response: GA's latency or an outage never delays Stripe's 200.
        after(() => trackCheckoutCompleted(subscription, session))

        break
      }

      case 'customer.subscription.updated': {
        // The event says which subscription changed; what is written is that subscription's
        // current state at Stripe, never the copy embedded in the event.
        const subscriptionId = (event.data.object as Stripe.Subscription).id
        await syncSubscription(supabase, event.type, subscriptionId)
        break
      }

      case 'customer.discount.created':
      case 'customer.discount.updated':
      case 'customer.discount.deleted': {
        // A coupon was applied to, changed on, or removed from (including a repeating coupon
        // that ended) a subscription or a customer. Only the managed AI allowance depends on it:
        // the subscription is read again and written like an update. A discount on the customer
        // (no subscription named) applies to the subscription the customer's account holds.
        const discount = event.data.object as Stripe.Discount
        const subscriptionId =
          discount.subscription ??
          (await storedSubscriptionIdForCustomer(supabase, event.type, discount.customer))

        if (!subscriptionId) {
          logUnmatchedEvent(event.type, null)
          break
        }

        await syncSubscription(supabase, event.type, subscriptionId)
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

      case 'checkout.session.expired': {
        // Analytics only, sent after the response: no database read or write and no Stripe
        // call, so it cannot fail in a way that asks Stripe to send it again.
        const expiredSession = event.data.object as Stripe.Checkout.Session
        after(() => trackCheckoutAbandoned(expiredSession))
        break
      }

      default:
        // Unhandled event type
        break
    }
  } catch (err) {
    // A SubscriptionSyncError's message is already the complete, payload-free log line.
    if (err instanceof SubscriptionSyncError) {
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

/** The shape of a Supabase user id. A metadata value of any other shape is never used as a key. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PostgREST's code for `.single()` finding no row (or more than one): a miss, not a failure. */
const NO_SINGLE_ROW = 'PGRST116'

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

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
 * fails is not a miss: it throws a SubscriptionSyncError (500, Stripe sends the event again), so a
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
 * Grants a one-time AI credit pack purchase: creditsForPayment() of the USD amount actually paid
 * for it (usdAmountPaid()), in the cost-based unit (1 credit = $0.001 of AI cost). The quantity
 * bought only set the price; a discounted pack grants proportionally fewer credits and a free one
 * none. When the session holds no USD amount, 0 credits are granted and a line is logged (better
 * to under-grant than to fund AI with money that wasn't received).
 *
 * Idempotent on stripe_checkout_session_id (unique constraint on ai_credit_purchases) — Stripe can
 * redeliver checkout.session.completed, and a duplicate insert must be a no-op, not a double
 * credit. Any other insert error throws a SubscriptionSyncError (500), so the event is delivered
 * again and the pack is granted then.
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

  const usdPaid = usdAmountPaid(session)
  if (usdPaid === null) {
    console.warn(
      `Stripe webhook: checkout.session.completed credit pack has no USD amount; 0 credits granted (session ${session.id})`
    )
  }
  const credits = usdPaid === null ? 0 : creditsForPayment(usdPaid)

  const { error } = await supabase.from('ai_credit_purchases').insert({
    user_id: userId,
    month,
    credits,
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
 * Reads a subscription from Stripe and writes its current state to its user's row: what
 * `customer.subscription.updated` does, and what a discount event does once it knows the
 * subscription. Nothing is written when Stripe has no such subscription or no user matches it
 * (logged, 200), or when the user's row tracks another subscription and this one isn't entitled.
 */
async function syncSubscription(
  supabase: ServiceRoleClient,
  eventType: string,
  subscriptionId: string
) {
  const subscription = await retrieveCurrentSubscription(eventType, subscriptionId)

  if (!subscription) {
    logUnmatchedEvent(eventType, subscriptionId)
    return
  }

  const owner = await resolveSubscriptionUserId(supabase, eventType, subscription)

  if (!owner) {
    logUnmatchedEvent(eventType, subscriptionId)
    return
  }

  // The upsert rewrites the user's one row. A subscription that row does not track yet
  // (the user was found through metadata or the profile, not the stored row) may take the
  // row over only while it is entitled: a new plan can start this way, but an ended or
  // unpaid subscription never replaces whatever the row holds now.
  if (owner.via !== 'stored_row' && !isEntitledSubscriptionStatus(subscription.status)) {
    logNotOnRecordEvent(eventType, subscriptionId, subscription.status)
    return
  }

  await upsertSubscription(supabase, eventType, subscription, owner.userId)
}

/** Prefix of the row the signup trigger creates (`free_<user id>`): it tracks no Stripe subscription. */
const SIGNUP_ROW_PREFIX = 'free_'

/**
 * The Stripe subscription id stored on the row of the account whose profile holds this Stripe
 * customer, for a discount on the customer rather than on a subscription. Null when no profile
 * holds the customer or its row tracks no Stripe subscription. A failed lookup throws a
 * SubscriptionSyncError (500).
 */
async function storedSubscriptionIdForCustomer(
  supabase: ServiceRoleClient,
  eventType: string,
  customer: Stripe.Discount['customer']
): Promise<string | null> {
  const customerId = typeof customer === 'string' ? customer : customer?.id
  if (!customerId) return null
  const reference = `customer discount`

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (profileError) throw databaseError(eventType, 'customer profile lookup', reference, profileError)
  if (!profile?.id) return null

  const { data: row, error: rowError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', profile.id)
    .maybeSingle()
  if (rowError) throw databaseError(eventType, 'subscription lookup', reference, rowError)

  const id = row?.id
  return typeof id === 'string' && id && !id.startsWith(SIGNUP_ROW_PREFIX) ? id : null
}

/**
 * The GA client id for a server-side checkout event: a random id, new for every event. Server
 * events are deliberately not joined to the buyer's browser session or account (the privacy
 * policy promises GA data isn't linked to an account), so the funnel is read as event counts.
 */
function analyticsClientId(): string {
  return randomUUID()
}

/** Domain label for the subkey derived from STRIPE_WEBHOOK_SECRET; bump the version to re-key. */
const GA_SESSION_ID_LABEL = 'tabmerger:ga-session-id:v1'

/** The subkey for the last STRIPE_WEBHOOK_SECRET seen, derived once (re-derived on rotation). */
let sessionIdSubkey: { secret: string; key: Buffer } | null = null

/**
 * A subkey only for GA session ids: HMAC-SHA256(STRIPE_WEBHOOK_SECRET, GA_SESSION_ID_LABEL). The
 * webhook secret itself never keys anything but Stripe's signature check.
 */
function sessionIdKey(secret: string): Buffer {
  if (sessionIdSubkey?.secret !== secret) {
    sessionIdSubkey = {
      secret,
      key: createHmac('sha256', secret).update(GA_SESSION_ID_LABEL).digest(),
    }
  }
  return sessionIdSubkey.key
}

/**
 * An opaque id for a Checkout Session in GA4 (`transaction_id`, `checkout_session_id`): the
 * HMAC-SHA256 (hex) of the session id, keyed with a subkey derived from `STRIPE_WEBHOOK_SECRET`
 * (sessionIdKey()). Stable for one
 * session, so GA4 can deduplicate a redelivered `purchase` and reports can count unique sessions,
 * but GA never sees the Stripe id. The key is server-only and never sent to Google (unlike
 * `GA_API_SECRET`, which travels in the Measurement Protocol query string) and is never logged.
 * Rotating it changes every id from then on. Null without it (no event is sent then).
 */
function analyticsSessionId(sessionId: string | undefined): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || typeof sessionId !== 'string' || !sessionId) return null
  return createHmac('sha256', sessionIdKey(secret)).update(sessionId).digest('hex')
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
function usdAmountPaid(session: Stripe.Checkout.Session): number | null {
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

/**
 * Reports a completed subscription checkout to GA4 server-side, since checkout success can happen
 * via redirect where the client-side page load isn't a reliable "did the payment actually
 * succeed" signal: this webhook, post signature-verification, is the source of truth. Sends two
 * events for the same moment, in parallel:
 *
 * - `checkout_completed`: the original custom event, params unchanged, so existing reports keep
 *   working. GA4 doesn't deduplicate it: a redelivery counts it again.
 * - `purchase`: GA4's recommended e-commerce event. `transaction_id` is analyticsSessionId(), which
 *   GA4 uses to drop a duplicate when Stripe delivers the event again; `value` is what was paid in
 *   USD (usdAmountPaid()), with one item for the plan.
 *
 * Each event gets its own random client id (analyticsClientId()); no `user_id` is sent. Called
 * after the response (via `after()`), and never throws: sendGa4Event() swallows errors and times
 * out.
 */
async function trackCheckoutCompleted(
  subscription: Stripe.Subscription,
  session: Stripe.Checkout.Session
) {
  const item = subscription.items.data[0]
  const plan = getPlanForPriceId(item?.price.id)
  if (!plan) return
  const { tier, interval: billing } = plan

  const transactionId = analyticsSessionId(session.id)
  if (!transactionId) return

  const listPrice = (item?.price.unit_amount ?? 0) / 100

  await Promise.all([
    sendGa4Event('web', {
      clientId: analyticsClientId(),
      name: ANALYTICS_EVENTS.checkoutCompleted,
      params: { tier, value: listPrice, currency: 'usd', billing },
    }),
    sendGa4Event('web', {
      clientId: analyticsClientId(),
      name: ANALYTICS_EVENTS.purchase,
      params: {
        transaction_id: transactionId,
        value: usdAmountPaid(session) ?? listPrice,
        currency: CHECKOUT_CURRENCY,
        tier,
        billing_interval: billing,
        environment: gaEnvironment(),
        // item_name tells Pro AI's two options apart ("Pro AI" / "Pro AI (own key)").
        items: [analyticsItem(plan.tierKey, billing, plan.aiMode ?? 'managed', listPrice)],
      },
    }),
  ])
}

/**
 * Reports `checkout_abandoned` for a subscription Checkout Session that expired unpaid
 * (`checkout.session.expired`). Writes nothing, calls nothing but GA4 and never throws, so the
 * webhook always answers 200 for it. GA4 doesn't deduplicate this event: if Stripe delivers it
 * twice, both carry the same `checkout_session_id` (analyticsSessionId()), so count unique ids.
 *
 * Only sessions this app created are reported: subscription mode with a well-formed
 * `metadata.user_id`, stamped by createCheckoutSession(). The user id only decides that; it is
 * never sent. Tier and interval come from metadata stamped from values the checkout route had
 * already validated; each is checked again here, and one that isn't a known value is left out.
 * Pro AI's option (`metadata.ai_mode`) picks the price and item name, defaulting to managed.
 */
async function trackCheckoutAbandoned(session: Stripe.Checkout.Session) {
  if (session.mode !== 'subscription') return

  const userId = session.metadata?.user_id
  if (!userId || !UUID_PATTERN.test(userId)) {
    console.warn(
      `Stripe webhook: checkout.session.expired was not created by this app; not reported (session ${session.id ?? 'unknown'})`
    )
    return
  }

  const checkoutSessionId = analyticsSessionId(session.id)
  if (!checkoutSessionId) return

  const rawTier = session.metadata?.tier ?? ''
  const rawInterval = session.metadata?.interval ?? ''
  const tier = (CHECKOUT_TIERS as readonly string[]).includes(rawTier)
    ? (rawTier as CheckoutTier)
    : null
  const interval = (CHECKOUT_INTERVALS as readonly string[]).includes(rawInterval)
    ? (rawInterval as CheckoutInterval)
    : null
  // Pro AI's option, stamped by the checkout route; anything else counts as TabMerger's key.
  const rawAiMode = session.metadata?.ai_mode
  const aiMode: AiMode = tier === 'proAi' && isAiMode(rawAiMode) ? rawAiMode : 'managed'

  const params: Ga4Params = {
    checkout_session_id: checkoutSessionId,
    environment: gaEnvironment(),
  }
  if (tier) params.tier = analyticsTier(tier)
  if (interval) params.billing_interval = interval
  if (tier && interval) {
    const value = checkoutValue(tier, interval, aiMode)
    params.value = value
    params.currency = CHECKOUT_CURRENCY
    params.items = [analyticsItem(tier, interval, aiMode, value)]
  }

  await sendGa4Event('web', {
    clientId: analyticsClientId(),
    name: ANALYTICS_EVENTS.checkoutAbandoned,
    params,
  })
}
