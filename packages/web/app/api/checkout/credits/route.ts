import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createCreditPackCheckoutSession } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'

/**
 * Creates a one-time Stripe Checkout session for an AI credit top-up
 * (extra AI calls for the current month, no rollover). Only useful to pro_ai users who've hit
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

  // Trust boundary: request comes from a UI input value. Clamp to [50, 500] — at $0.10/call,
  // anything below 50 calls ($5) risks Stripe's $0.50 minimum-charge floor and gets eaten by
  // per-transaction processing fees, so 50 is the smallest amount actually worth selling.
  const body = await request.json().catch(() => ({}))
  const rawQuantity = Number(body?.quantity)
  const quantity =
    Number.isInteger(rawQuantity) && rawQuantity >= 50 && rawQuantity <= 500 ? rawQuantity : 50

  try {
    const url = await createCreditPackCheckoutSession({
      userId: user.id,
      quantity,
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
