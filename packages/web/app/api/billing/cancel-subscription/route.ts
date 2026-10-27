import { NextResponse, type NextRequest } from 'next/server'
import { CancelSubscriptionError, createCancelSubscriptionSession } from '@/lib/stripe'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { CANCEL_SUBSCRIPTION_ERROR_CODES as CODES } from '@/lib/checkoutErrors'
import { describeStripeError } from '@/lib/stripeErrors'
import { absoluteUrl } from '@/lib/utils'

/**
 * Opens Stripe's own "cancel plan" page for the signed-in user's subscription
 * (createCancelSubscriptionSession() in lib/stripe.ts). The account page uses it while a plan
 * change is scheduled, because the Billing Portal's home page offers no cancellation then;
 * confirming on Stripe's page releases the schedule, keeps the current plan and ends it at the
 * end of the paid period, with no refund or credit. Nothing is written here: the webhook records
 * the result.
 *
 * Session-cookie auth, like `/api/billing-portal`. The body is ignored: the subscription is the one
 * stored for the caller (their newest `subscriptions` row), and Stripe must say it belongs to the
 * caller's own customer (`profiles.stripe_customer_id`), so no other account's subscription can be
 * reached.
 *
 * Responds `{ url }`, or 401, 400 `no_billing_account`, 404 `no_subscription` (none stored, unknown
 * at Stripe, or not this customer's), 409 `not_entitled` / `already_canceling`, 500 `cancel_failed`
 * (a failed database read, logged with its error code; or a Stripe failure, logged with the Stripe
 * error's type, code and request id).
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceClient = await createServiceRoleClient()
  const failed = (what: string, code: unknown) => {
    console.error(`Cancel subscription: reading the ${what} failed (code ${typeof code === 'string' ? code : 'unknown'})`)
    return NextResponse.json({ error: 'Failed to open the cancellation page', code: CODES.failed }, { status: 500 })
  }

  const reads = await Promise.all([
    serviceClient.from('profiles').select('stripe_customer_id').eq('id', user.id).single(),
    serviceClient
      .from('subscriptions')
      .select('id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]).catch(() => null)
  if (!reads) return failed('profile and subscription', undefined)
  const [profileResult, rowResult] = reads
  // A read that failed is not "no billing account" or "no subscription": the account may well have
  // both, so it answers 500 like any other failure. `.single()` reports a missing profile row as
  // PGRST116, which is the no-account case below.
  if (profileResult.error && profileResult.error.code !== 'PGRST116') return failed('profile', profileResult.error.code)
  if (rowResult.error) return failed('subscription', rowResult.error.code)
  const profile = profileResult.data
  const row = rowResult.data

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found', code: CODES.noBillingAccount }, { status: 400 })
  }
  if (!row?.id) {
    return NextResponse.json({ error: 'No subscription found', code: CODES.noSubscription }, { status: 404 })
  }

  try {
    const url = await createCancelSubscriptionSession({
      customerId: profile.stripe_customer_id,
      subscriptionId: row.id,
      returnUrl: absoluteUrl('/account'),
    })
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof CancelSubscriptionError) {
      if (err.reason === 'not_found') {
        console.warn(`Cancel subscription: subscription ${row.id} is unknown at Stripe or not this customer's`)
        return NextResponse.json({ error: 'No subscription found', code: CODES.noSubscription }, { status: 404 })
      }
      if (err.reason === 'already_canceling') {
        return NextResponse.json(
          { error: 'Your plan is already set to end at the end of this billing period.', code: CODES.alreadyCanceling },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'There is no active plan to cancel.', code: CODES.notEntitled }, { status: 409 })
    }
    console.error(`Cancel subscription: opening the cancel flow failed: ${describeStripeError(err)}`)
    return NextResponse.json({ error: 'Failed to open the cancellation page', code: CODES.failed }, { status: 500 })
  }
}
