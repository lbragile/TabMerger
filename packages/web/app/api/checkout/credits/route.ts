import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCreditPackCheckoutSession } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'

/**
 * Creates a one-time Stripe Checkout session for an AI credit pack top-up
 * (+50 AI calls for the current month, no rollover). Only useful to pro_ai users who've hit
 * AI_MONTHLY_CAP, but not gated on tier here — the AI routes are the enforcement point;
 * a non-pro_ai user buying credits just won't have anything to spend them against.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  try {
    const url = await createCreditPackCheckoutSession({
      userId: user.id,
      customerEmail: user.email,
      customerId: profile?.stripe_customer_id ?? undefined,
      successUrl: absoluteUrl('/dashboard?credits=1'),
      cancelUrl: absoluteUrl('/dashboard'),
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error('Credit pack checkout session error:', err)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
