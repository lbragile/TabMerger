import { NextResponse, type NextRequest } from 'next/server'
import { AI_ERROR_CODES, isAiEnabled } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { createCreditPackCheckoutSession } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'
import { AI_DISABLED_ERROR } from '@/lib/ai-guard'

/** Smallest and largest pack, in Price units ($0.05 each): $2.50 to $25. */
const MIN_PACK_UNITS = 50
const MAX_PACK_UNITS = 500

/**
 * Creates a one-time Stripe Checkout session for an AI credit top-up (extra managed AI credits
 * for the current month, no rollover). The credits granted come from the USD amount actually
 * paid, not from the quantity: the webhook converts it with `creditsForPayment()` from
 * `@tabmerger/shared` (so a $2.50 pack is 820 credits and a discounted pack proportionally fewer).
 *
 * Only managed Pro AI spends credits. A Pro AI subscriber on their own Anthropic key (`ai_mode =
 * 'byok'`) gets 409 `{ error: 'credits_not_applicable' }` before any Stripe call. Other accounts
 * are not refused here: the AI routes are the enforcement point, and credits bought without a
 * managed Pro AI plan have nothing to be spent against.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AI credit packs are only spendable by pro_ai, which is itself behind the "coming soon"
  // flag — reject before any Stripe call while the flag is off.
  if (!isAiEnabled(process.env.NEXT_PUBLIC_AI_ENABLED)) {
    return NextResponse.json({ error: AI_DISABLED_ERROR }, { status: 503 })
  }

  // The caller's own row (cookie-scoped client; RLS lets a user read only their own row). A
  // failed read stops the request rather than selling a pack that may not be usable.
  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('tier, ai_mode')
    .eq('user_id', user.id)
    .maybeSingle()

  if (subscriptionError) {
    console.error('Credit pack subscription lookup error:', subscriptionError.code)
    return NextResponse.json({ error: 'Failed to check the current plan' }, { status: 500 })
  }

  if (subscription?.tier === 'pro_ai' && subscription.ai_mode === 'byok') {
    return NextResponse.json({ error: AI_ERROR_CODES.creditsNotApplicable }, { status: 409 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  // Trust boundary: request comes from a UI input value. Clamp to [50, 500] Price units — at
  // $0.05 each the smallest pack is $2.50, clear of Stripe's $0.50 minimum charge and big enough
  // that the fixed per-payment fee doesn't eat it.
  const body = await request.json().catch(() => ({}))
  const rawQuantity = Number(body?.quantity)
  const quantity =
    Number.isInteger(rawQuantity) && rawQuantity >= MIN_PACK_UNITS && rawQuantity <= MAX_PACK_UNITS
      ? rawQuantity
      : MIN_PACK_UNITS

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
