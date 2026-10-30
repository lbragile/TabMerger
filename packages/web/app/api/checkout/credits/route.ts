import { NextResponse, type NextRequest } from 'next/server'
import { AI_ERROR_CODES, aiAvailability } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { createCreditPackCheckoutSession } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'
import { AI_DISABLED_ERROR } from '@/lib/ai-guard'
import { hasProAi, toAiSubscription } from '@/lib/ai-usage'
import { CREDITS_NOT_AVAILABLE_ERROR } from '@/lib/checkoutErrors'
import { limitBillingRequest, rejectCrossOriginPost } from '@/lib/billingRequestGuard'

/** Smallest and largest pack, in Price units ($0.05 each): $2.50 to $25. */
const MIN_PACK_UNITS = 50
const MAX_PACK_UNITS = 500

/**
 * Creates a one-time Stripe Checkout session for an AI credit top-up (extra managed AI credits
 * for the current month, no rollover). The credits granted come from the USD amount actually
 * paid, not from the quantity: the webhook converts it with `creditsForPayment()` from
 * `@tabmerger/shared` (so a $2.50 pack is 820 credits and a discounted pack proportionally fewer).
 *
 * Sold only to an account that can spend them, the rule the AI routes enforce: tier `pro_ai` on an
 * entitled status (`hasProAi()`: active, trialing or past_due) with `ai_mode = 'managed'`. Checked
 * before any Stripe call:
 * - no such plan (free, Pro, no row, or Pro AI incomplete/canceled/unpaid/paused): 403
 *   `{ error: 'credits_not_available' }` (`CREDITS_NOT_AVAILABLE_ERROR`);
 * - an entitled Pro AI subscriber on their own AI provider key (`ai_mode = 'byok'`): 409
 *   `{ error: 'credits_not_applicable' }` (`AI_ERROR_CODES.creditsNotApplicable`).
 *
 * Guards before anything else (lib/billingRequestGuard.ts): 403 `forbidden_origin` unless posted
 * from a page of this origin, then 429 `rate_limited` (with `Retry-After`) past the per-user billing
 * limit, counted after authentication.
 */
export async function POST(request: NextRequest) {
  const crossOrigin = rejectCrossOriginPost(request)
  if (crossOrigin) return crossOrigin

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limited = await limitBillingRequest(user.id)
  if (limited) return limited

  // Credit packs are only spent by managed Pro AI, so they are sold only while managed AI is on
  // (the own-key flag alone doesn't sell them) — reject before any Stripe call otherwise.
  if (!aiAvailability(process.env.NEXT_PUBLIC_AI_ENABLED, process.env.NEXT_PUBLIC_AI_BYOK_ENABLED).managed) {
    return NextResponse.json({ error: AI_DISABLED_ERROR }, { status: 503 })
  }

  // The caller's own row (cookie-scoped client; RLS lets a user read only their own row). A
  // failed read stops the request rather than selling a pack that may not be usable.
  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('tier, status, ai_mode')
    .eq('user_id', user.id)
    .maybeSingle()

  if (subscriptionError) {
    console.error('Credit pack subscription lookup error:', subscriptionError.code)
    return NextResponse.json({ error: 'Failed to check the current plan' }, { status: 500 })
  }

  // The spend side's own test (lib/ai-usage.ts), so a pack is never sold to an account whose AI
  // calls would be refused. A missing ai_mode reads as managed, the column default, as it does there.
  const aiSubscription = toAiSubscription(subscription)
  if (!hasProAi(aiSubscription)) {
    return NextResponse.json({ error: CREDITS_NOT_AVAILABLE_ERROR }, { status: 403 })
  }
  if (aiSubscription.aiMode !== 'managed') {
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
