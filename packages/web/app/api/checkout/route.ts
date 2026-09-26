import { NextResponse, type NextRequest } from 'next/server'
import { isAiEnabled } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession, getStripePriceId } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'
import { AI_DISABLED_ERROR } from '@/lib/ai-guard'

/**
 * Creates a Stripe Checkout session for upgrading to Pro or Pro AI.
 * Called by the pricing page / upgrade flow (dashboard user, session-cookie auth).
 * Passes the existing stripe_customer_id if present so Stripe reuses the billing account on re-subscribe.
 * Returns a redirect URL; the client is responsible for navigating to it.
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
