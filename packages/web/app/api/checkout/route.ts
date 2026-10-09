import { NextResponse, type NextRequest } from 'next/server'
import { isAiEnabled, isEntitledSubscriptionStatus } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession, getStripePriceId } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'
import { AI_DISABLED_ERROR } from '@/lib/ai-guard'
import { ALREADY_SUBSCRIBED_ERROR } from '@/lib/checkoutErrors'

/**
 * Creates a Stripe Checkout session for starting a Pro or Pro AI subscription.
 * Called by the pricing page / upgrade flow (dashboard user, session-cookie auth).
 * Passes the existing stripe_customer_id if present so Stripe reuses the billing account on re-subscribe.
 * Returns a redirect URL; the client is responsible for navigating to it.
 *
 * An account holds one subscription. A caller whose row is already on a paid tier with an
 * entitled status gets 409 `{ error: 'already_subscribed' }` and no Stripe call: changing plan
 * or interval is done in the Billing Portal, on the existing subscription.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { tier, interval } = await request.json()

  if (!['pro', 'proAi'].includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  if (!['monthly', 'yearly'].includes(interval)) {
    return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
  }

  // AI features are behind a "coming soon" flag — reject pro_ai at every interval
  // before touching Stripe at all, regardless of what the client sends.
  if (tier === 'proAi' && !isAiEnabled(process.env.NEXT_PUBLIC_AI_ENABLED)) {
    return NextResponse.json({ error: AI_DISABLED_ERROR }, { status: 503 })
  }

  // One subscription per account. Read with the caller's own (cookie-scoped) client: RLS lets a
  // user select only their own row and gives them no way to write it, so this is the same row
  // the pricing page shows, with no need for the service role here. A failed read stops the
  // request rather than letting it through.
  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', user.id)
    .maybeSingle()

  if (subscriptionError) {
    console.error('Checkout subscription lookup error:', subscriptionError.code)
    return NextResponse.json({ error: 'Failed to check the current plan' }, { status: 500 })
  }

  if (
    subscription &&
    subscription.tier !== 'free' &&
    isEntitledSubscriptionStatus(subscription.status)
  ) {
    return NextResponse.json({ error: ALREADY_SUBSCRIBED_ERROR }, { status: 409 })
  }

  const priceId = getStripePriceId(tier as 'pro' | 'proAi', interval)

  if (!priceId) {
    return NextResponse.json(
      { error: 'Price ID not configured' },
      { status: 500 }
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  try {
    const url = await createCheckoutSession({
      userId: user.id,
      priceId,
      customerEmail: user.email,
      customerId: profile?.stripe_customer_id ?? undefined,
      successUrl: absoluteUrl('/dashboard?upgraded=1'),
      cancelUrl: absoluteUrl('/pricing'),
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error('Checkout session error:', err)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
