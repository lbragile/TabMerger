import { NextResponse, type NextRequest } from 'next/server'
import { aiAvailability, isAiMode, isEntitledSubscriptionStatus, type AiMode } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { createCheckoutSession, getStripePriceId } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'
import { AI_DISABLED_ERROR } from '@/lib/ai-guard'
import {
  ALREADY_SUBSCRIBED_ERROR,
  BILLING_CHECK_FAILED_ERROR,
  CheckoutRaceLostError,
  PAY_OR_RESUME_ERROR,
} from '@/lib/checkoutErrors'
import { checkStripeBeforeCheckout } from '@/lib/checkoutGuard'
import { describeStripeError } from '@/lib/stripeErrors'
import { checkoutCancelPath } from '@/lib/checkoutAnalytics'
import { DEFAULT_LOCALE, isAppLocale } from '@/i18n/locales'

/** PostgREST's code for `.single()` finding no row: a miss, not a failure. */
const NO_SINGLE_ROW = 'PGRST116'

/** next-intl's locale cookie. */
const LOCALE_COOKIE = 'NEXT_LOCALE'

/**
 * The locale the buyer is browsing in, for the cancel_url: the first path segment of the page
 * that sent the request (Referer), else the NEXT_LOCALE cookie, else the default locale. Both
 * are client-supplied, so a value is used only when it is one of this build's locales.
 */
function requestLocale(request: NextRequest): string {
  const referer = request.headers.get('referer')
  if (referer) {
    try {
      const segment = new URL(referer).pathname.split('/')[1]
      if (isAppLocale(segment)) return segment
    } catch {
      // Not a URL: fall through to the cookie.
    }
  }
  const cookie = request.cookies.get(LOCALE_COOKIE)?.value
  return isAppLocale(cookie) ? cookie : DEFAULT_LOCALE
}

/** Whether a Pro AI option is on sale, read from both AI flags on every call. */
function proAiOptionAvailable(aiMode: AiMode): boolean {
  return aiAvailability(process.env.NEXT_PUBLIC_AI_ENABLED, process.env.NEXT_PUBLIC_AI_BYOK_ENABLED)[aiMode]
}

/**
 * Creates a Stripe Checkout session for starting a Pro or Pro AI subscription.
 * Body: `{ tier: 'pro' | 'proAi', interval: 'monthly' | 'yearly', aiMode?: 'managed' | 'byok' }`.
 * `aiMode` picks Pro AI's option (TabMerger's key, the default, or the customer's own key, which
 * is a different, cheaper Price); any other value, or `byok` with Pro, is a 400.
 * Called by the pricing page / upgrade flow (dashboard user, session-cookie auth).
 * Passes the existing stripe_customer_id if present so Stripe reuses the billing account on re-subscribe.
 * Returns a redirect URL; the client is responsible for navigating to it.
 *
 * An account holds one subscription, checked in this order before anything is sold:
 * 1. The account's row: a paid tier with an entitled status is 409 `{ error: 'already_subscribed',
 *    recorded: true }`, with no Stripe call. Changing plan or interval is done on the existing
 *    subscription (plan switch or Billing Portal).
 * 2. Stripe, when the profile has a Stripe customer (checkStripeBeforeCheckout() in
 *    lib/checkoutGuard.ts), for a row that is behind Stripe: a live subscription is 409
 *    `already_subscribed` (`recorded` says whether the row was just written from Stripe); one that
 *    can still be paid or resumed is 409 `pay_or_resume`; a list that can't be read is 503
 *    `billing_check_failed` (fail closed). A customer Stripe doesn't have is dropped and Checkout
 *    makes a new one.
 * Creating the session expires the customer's other open subscription checkouts (two tabs), see
 * createCheckoutSession() in lib/stripe.ts; if one of them was paid meanwhile, the new session is
 * withdrawn too and the answer is 409 `already_subscribed`. A profile read that fails (not "no
 * row") is 503 `billing_check_failed` before any Stripe call.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A body that is not JSON, or not a JSON object, is read as empty and gets the 400 below.
  const body = await request.json().catch(() => null)
  const { tier, interval, aiMode: rawAiMode } = body && typeof body === 'object' ? body : {}

  if (!['pro', 'proAi'].includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  if (!['monthly', 'yearly'].includes(interval)) {
    return NextResponse.json({ error: 'Invalid interval' }, { status: 400 })
  }

  // Pro AI's option: TabMerger's key (`managed`, the default) or the customer's own (`byok`).
  // Pro has no AI, so only a missing value or `managed` is accepted with it.
  const aiMode: AiMode = rawAiMode === undefined ? 'managed' : rawAiMode
  if (!isAiMode(aiMode) || (tier === 'pro' && aiMode !== 'managed')) {
    return NextResponse.json({ error: 'Invalid aiMode' }, { status: 400 })
  }

  // Each Pro AI option is sold only while its flag is on (aiAvailability(): the managed flag
  // also turns on the own-key option, and the own-key flag can launch it alone). Rejected at
  // every interval before touching Stripe at all, regardless of what the client sends.
  if (tier === 'proAi' && !proAiOptionAvailable(aiMode)) {
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
    return NextResponse.json({ error: ALREADY_SUBSCRIBED_ERROR, recorded: true }, { status: 409 })
  }

  const priceId = getStripePriceId(tier as 'pro' | 'proAi', interval, aiMode)

  if (!priceId) {
    return NextResponse.json(
      { error: 'Price ID not configured' },
      { status: 500 }
    )
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  // A failed read must not look like "no Stripe customer yet": that would skip the Stripe check
  // and sell on a new customer. Only "no row" (PGRST116) means there is no customer.
  if (profileError && profileError.code !== NO_SINGLE_ROW) {
    console.error('Checkout profile lookup error:', profileError.code)
    return NextResponse.json({ error: BILLING_CHECK_FAILED_ERROR }, { status: 503 })
  }

  // The row can be behind Stripe (a missed webhook delivery): ask Stripe before selling a second
  // subscription to a customer that may already have one. No customer yet means nothing to ask.
  let customerId: string | undefined = profile?.stripe_customer_id ?? undefined
  if (customerId) {
    const guard = await checkStripeBeforeCheckout(user.id, customerId)
    if (guard.kind === 'live') {
      return NextResponse.json({ error: ALREADY_SUBSCRIBED_ERROR, recorded: guard.recorded }, { status: 409 })
    }
    if (guard.kind === 'open') {
      return NextResponse.json({ error: PAY_OR_RESUME_ERROR }, { status: 409 })
    }
    if (guard.kind === 'check_failed') {
      return NextResponse.json({ error: BILLING_CHECK_FAILED_ERROR }, { status: 503 })
    }
    if (guard.kind === 'customer_missing') customerId = undefined
  }

  try {
    const url = await createCheckoutSession({
      userId: user.id,
      priceId,
      customerEmail: user.email,
      customerId,
      successUrl: absoluteUrl('/dashboard?upgraded=1'),
      // The marker lets the pricing page count the cancel (checkout_canceled) once, then drop it.
      cancelUrl: absoluteUrl(checkoutCancelPath(tier, interval, requestLocale(request), aiMode)),
      tier,
      interval,
      // Only Pro AI has the option; Pro sessions carry no ai_mode.
      ...(tier === 'proAi' ? { aiMode } : {}),
    })

    return NextResponse.json({ url })
  } catch (err) {
    // Another tab's checkout was paid while this one opened: that plan is live, this session is
    // withdrawn (lib/stripe.ts logged it), and the completed session's webhook records the plan.
    if (err instanceof CheckoutRaceLostError) {
      return NextResponse.json({ error: ALREADY_SUBSCRIBED_ERROR, recorded: false }, { status: 409 })
    }
    // One line with the Stripe error's type, code and request id; never the error object.
    console.error(`Checkout session error: ${describeStripeError(err)}`)
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    )
  }
}
