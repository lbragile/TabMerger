import { NextResponse, type NextRequest } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type Stripe from 'stripe'

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

  const supabase = await createServiceRoleClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        if (session.mode !== 'subscription') break

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        )

        const customerId = session.customer as string
        const userId = subscription.metadata?.user_id

        if (!userId) {
          // Look up user by customer ID from profiles table
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single()

          if (!profile) break

          await upsertSubscription(supabase, subscription, profile.id)
        } else {
          await upsertSubscription(supabase, subscription, userId)
        }

        // Store stripe_customer_id on profile
        await supabase
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', userId ?? '')

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

async function upsertSubscription(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  subscription: Stripe.Subscription,
  userId: string
) {
  const priceId = subscription.items.data[0]?.price.id
  const tier = getTierFromPriceId(priceId)

  await supabase.from('subscriptions').upsert({
    id: subscription.id,
    user_id: userId,
    tier,
    status: subscription.status,
    current_period_end: new Date(
      subscription.current_period_end * 1000
    ).toISOString(),
    updated_at: new Date().toISOString(),
  })
}

function getTierFromPriceId(priceId: string | undefined): string {
  if (!priceId) return 'free'

  const proMonthly = process.env.STRIPE_PRO_MONTHLY_PRICE_ID
  const proYearly = process.env.STRIPE_PRO_YEARLY_PRICE_ID
  const proAiMonthly = process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID
  const proAiYearly = process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID

  if (priceId === proMonthly || priceId === proYearly) return 'pro'
  if (priceId === proAiMonthly || priceId === proAiYearly) return 'pro_ai'
  return 'free'
}
