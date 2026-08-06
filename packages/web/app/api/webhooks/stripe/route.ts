import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { stripe, AI_CREDIT_PACK_SIZE } from '@/lib/stripe'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type Stripe from 'stripe'

/**
 * Stripe webhook receiver. Verifies the event signature, then handles subscription lifecycle
 * events (checkout completed, updated, deleted, payment failed) by syncing state to Supabase.
 * Must read the body as raw text — JSON parsing mutates bytes and breaks the HMAC signature check.
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

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        )

        const customerId = session.customer as string

        // Resolve the Supabase user ID from most-reliable to least-reliable source:
        // 1. subscription.metadata.user_id — set via subscription_data.metadata in createCheckoutSession
        // 2. session.metadata.user_id     — set via top-level metadata in createCheckoutSession
        // 3. profile lookup by stripe_customer_id — handles legacy/returning customers
        let resolvedUserId =
          subscription.metadata?.user_id ?? session.metadata?.user_id ?? null

        if (!resolvedUserId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (!profile) {
            console.error(
              'checkout.session.completed: cannot resolve user for Stripe customer',
              customerId
            )
            break
          }

          resolvedUserId = profile.id
        }

        // Ensure the customer ID is persisted on the profile so future webhook
        // events (subscription.updated / deleted) can look up the user by customer ID.
        await supabase
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', resolvedUserId)

        await upsertSubscription(supabase, subscription, resolvedUserId)
        await trackCheckoutCompleted(subscription, resolvedUserId)

        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', subscription.customer as string)
          .single()

        if (!profile) break
        await upsertSubscription(supabase, subscription, profile.id)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', subscription.customer as string)
          .single()

        if (!profile) break

        await supabase
          .from('subscriptions')
          .update({ status: 'canceled', tier: 'free' })
          .eq('id', subscription.id)

        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (!profile) break

        await supabase
          .from('subscriptions')
          .update({ status: 'past_due' })
          .eq('user_id', profile.id)

        break
      }

      default:
        // Unhandled event type
        break
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({ received: true })
}

/**
 * Grants a one-time AI credit pack purchase. Idempotent on stripe_checkout_session_id
 * (unique constraint on ai_credit_purchases) — Stripe can redeliver checkout.session.completed,
 * and a duplicate insert must be a no-op, not a double credit.
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

  const { error } = await supabase.from('ai_credit_purchases').insert({
    user_id: userId,
    month,
    credits: AI_CREDIT_PACK_SIZE,
    stripe_checkout_session_id: session.id,
  })

  // Unique violation on stripe_checkout_session_id = already credited this event, not an error.
  if (error && error.code !== '23505') {
    console.error('creditAiCreditPack insert error:', error)
  }
}

/**
 * Writes or updates a subscription row keyed on the Stripe subscription ID.
 * Derives the app tier from the price ID via env-var mapping; defaults to 'free' on unknown prices.
 * Side-effect: logs errors but does not throw — webhook must always return 200 to avoid Stripe retries.
 */
async function upsertSubscription(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  subscription: Stripe.Subscription,
  userId: string
) {
  const priceId = subscription.items.data[0]?.price.id
  const tier = getTierFromPriceId(priceId)

  const { error } = await supabase.from('subscriptions').upsert(
    {
      id: subscription.id,
      user_id: userId,
      tier,
      status: subscription.status,
      stripe_price_id: priceId,
      cancel_at_period_end: subscription.cancel_at_period_end,
      // ponytail: Stripe v22 moved current_period_end from Subscription to SubscriptionItem
      current_period_end: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  )
  if (error) console.error('upsertSubscription error:', error)
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
