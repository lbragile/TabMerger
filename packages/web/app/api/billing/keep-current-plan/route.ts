import { NextResponse, type NextRequest } from 'next/server'
import { KeepCurrentPlanError, keepCurrentPlan } from '@/lib/stripe'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { KEEP_CURRENT_PLAN_ERROR_CODES as CODES } from '@/lib/checkoutErrors'
import { describeStripeError } from '@/lib/stripeErrors'
import { limitBillingRequest, rejectCrossOriginPost } from '@/lib/billingRequestGuard'

/**
 * Undoes the signed-in user's scheduled plan change ("Keep my current plan" on the account page),
 * without a trip through the Billing Portal: keepCurrentPlan() in lib/stripe.ts releases the
 * subscription schedule that holds the change, so the subscription stays on its current price and
 * renews on it, with no proration, invoice, charge or credit. Nothing is written to the database
 * here: Stripe's `customer.subscription.updated` reaches the webhook, which records the result.
 *
 * Session-cookie auth, like `/api/billing/cancel-subscription`. The body is ignored: the
 * subscription is the one stored for the caller (their newest `subscriptions` row), Stripe must say
 * it belongs to the caller's own customer (`profiles.stripe_customer_id`), and the schedule
 * released is the one Stripe reports on that subscription, re-read now. No id from the client is
 * ever used.
 *
 * Responds `{ ok: true, renewal? }`: `renewal` is `{ at, amount?, currency? }` when the plan
 * renews (absent when it is set to end): `at` is the renewal date (ISO), `amount` (major units, e.g.
 * 42.99) and `currency` (ISO 4217) are what Stripe's preview of the next invoice says will be
 * charged, discounts and tax included, and are left out when that preview fails (the plan is kept
 * either way). Errors: 401, 403 `forbidden_origin` (not posted from a page of this origin,
 * rejectCrossOriginPost()), 429 `rate_limited` (with `Retry-After`, limitBillingRequest()), 400
 * `no_billing_account`, 404 `no_subscription` (none stored, unknown at Stripe, or not this
 * customer's), 409 `no_scheduled_change` (nothing scheduled, or already undone by an earlier
 * click), 500 `keep_plan_failed` (a failed database read, logged with its error code; or a Stripe
 * failure, logged with the Stripe error's type, code and request id).
 */
export async function POST(request: NextRequest) {
  const crossOrigin = rejectCrossOriginPost(request)
  if (crossOrigin) return crossOrigin

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await limitBillingRequest(user.id)
  if (limited) return limited

  const serviceClient = await createServiceRoleClient()
  const failed = (what: string, code: unknown) => {
    console.error(`Keep current plan: reading the ${what} failed (code ${typeof code === 'string' ? code : 'unknown'})`)
    return NextResponse.json({ error: 'Failed to keep the current plan', code: CODES.failed }, { status: 500 })
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
  // both, so it answers 500. `.single()` reports a missing profile row as PGRST116, which is the
  // no-account case below.
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
    const renewal = await keepCurrentPlan({ customerId: profile.stripe_customer_id, subscriptionId: row.id })
    return NextResponse.json(
      renewal
        ? {
            ok: true,
            renewal: {
              at: new Date(renewal.at * 1000).toISOString(),
              ...(renewal.amount !== undefined && renewal.currency
                ? { amount: renewal.amount, currency: renewal.currency }
                : {}),
            },
          }
        : { ok: true }
    )
  } catch (err) {
    if (err instanceof KeepCurrentPlanError) {
      if (err.reason === 'not_found') {
        console.warn(`Keep current plan: subscription ${row.id} is unknown at Stripe or not this customer's`)
        return NextResponse.json({ error: 'No subscription found', code: CODES.noSubscription }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'No plan change is scheduled.', code: CODES.noScheduledChange },
        { status: 409 }
      )
    }
    console.error(`Keep current plan: releasing the schedule failed: ${describeStripeError(err)}`)
    return NextResponse.json({ error: 'Failed to keep the current plan', code: CODES.failed }, { status: 500 })
  }
}
