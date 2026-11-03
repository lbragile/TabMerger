import { NextResponse, type NextRequest } from 'next/server'
import { ResumeSubscriptionError, resumeSubscription } from '@/lib/stripe'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { RESUME_SUBSCRIPTION_ERROR_CODES as CODES } from '@/lib/checkoutErrors'
import { describeStripeError } from '@/lib/stripeErrors'
import { limitBillingRequest, rejectCrossOriginPost } from '@/lib/billingRequestGuard'

/**
 * Undoes the signed-in user's cancellation ("Keep my plan" on the account page) without a trip
 * through the Billing Portal: resumeSubscription() in lib/stripe.ts clears the subscription's
 * cancellation at the end of the period, so it renews on its current price, with no proration,
 * invoice, charge or credit now. Nothing is written to the database here: Stripe's
 * `customer.subscription.updated` reaches the webhook, which records the result.
 *
 * Session-cookie auth, like `/api/billing/keep-current-plan`. The body is ignored: the subscription
 * is the one stored for the caller (their newest `subscriptions` row), and Stripe must say it
 * belongs to the caller's own customer (`profiles.stripe_customer_id`). No id from the client is
 * ever used.
 *
 * Responds `{ ok: true, renewal? }`: `renewal` is `{ at, amount?, currency? }`: `at` is the renewal
 * date (ISO), `amount` (major units) and `currency` (ISO 4217) what Stripe's preview of the next
 * invoice says will be charged, left out when that preview fails (the plan is kept either way).
 * Errors: 401, 403 `forbidden_origin` (rejectCrossOriginPost()), 429 `rate_limited` (with
 * `Retry-After`), 400 `no_billing_account`, 404 `no_subscription` (none stored, unknown at Stripe,
 * or not this customer's), 409 `not_entitled` (the plan has ended or isn't paid up), 409
 * `not_canceling` (not set to end, or already kept by an earlier click), 409 `ends_early` (set to
 * end before its paid period would; support only), 409 `schedule_attached` (a subscription
 * schedule set up in the Dashboard is attached; support only), 500 `resume_failed` (a failed database read,
 * logged with its error code; or a Stripe failure, logged with the Stripe error's type, code and
 * request id).
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
    console.error(`Resume subscription: reading the ${what} failed (code ${typeof code === 'string' ? code : 'unknown'})`)
    return NextResponse.json({ error: 'Failed to keep the plan', code: CODES.failed }, { status: 500 })
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
  // A failed read is not "no billing account" or "no subscription": the account may well have
  // both, so it answers 500. `.single()` reports a missing profile row as PGRST116.
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
    const renewal = await resumeSubscription({ customerId: profile.stripe_customer_id, subscriptionId: row.id })
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
    if (err instanceof ResumeSubscriptionError) {
      switch (err.reason) {
        case 'not_found':
          console.warn(`Resume subscription: subscription ${row.id} is unknown at Stripe or not this customer's`)
          return NextResponse.json({ error: 'No subscription found', code: CODES.noSubscription }, { status: 404 })
        case 'not_entitled':
          return NextResponse.json(
            { error: 'This plan has ended, so it can no longer be kept.', code: CODES.notEntitled },
            { status: 409 }
          )
        case 'not_canceling':
          return NextResponse.json(
            { error: 'Your plan is not set to end.', code: CODES.notCanceling },
            { status: 409 }
          )
        case 'ends_early':
          return NextResponse.json(
            { error: 'This plan ends on a date set by support. Contact us to keep it.', code: CODES.endsEarly },
            { status: 409 }
          )
        case 'schedule_attached':
          return NextResponse.json(
            { error: 'This plan has changes set up by support. Contact us to keep it.', code: CODES.scheduleAttached },
            { status: 409 }
          )
      }
    }
    console.error(`Resume subscription: clearing the cancellation failed: ${describeStripeError(err)}`)
    return NextResponse.json({ error: 'Failed to keep the plan', code: CODES.failed }, { status: 500 })
  }
}
