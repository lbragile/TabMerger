import { NextResponse, type NextRequest } from 'next/server'
import { createIntervalSwitchSession, IntervalSwitchError } from '@/lib/stripe'
import { getStripePriceId, type BillingInterval } from '@/lib/tiers'
import { hasCloudSync } from '@/lib/cloudSync'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/utils'

const INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly']

/**
 * Moves the signed-in user's paid plan to the other billing interval (monthly ↔ yearly) by
 * returning a Billing Portal URL that opens on Stripe's "confirm plan change" page. Only the
 * interval can change here: the target is always the same tier the user already pays for, so
 * this can't be used to reach a different (or unreleased) plan. The subscription row is written
 * by the webhook once Stripe confirms, never by this route.
 *
 * Body: `{ interval: 'monthly' | 'yearly' }`. Responds `{ url }`, or 400 (bad body / no billing
 * account), 401, 403 (no paid plan), 409 (already on that interval, or a switch is already
 * scheduled; `error` is shown to the user), 503 (price not configured).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { interval?: unknown } | null
  const interval = body?.interval
  if (!INTERVALS.includes(interval as BillingInterval)) {
    return NextResponse.json({ error: 'interval must be "monthly" or "yearly"' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!hasCloudSync(subscription)) {
    return NextResponse.json({ error: 'No paid plan to switch' }, { status: 403 })
  }

  const tierKey = subscription!.tier === 'pro_ai' ? 'proAi' : 'pro'
  const targetPriceId = getStripePriceId(tierKey, interval as BillingInterval)
  const planPriceIds = INTERVALS.map((i) => getStripePriceId(tierKey, i)).filter(
    (id): id is string => Boolean(id)
  )
  if (!targetPriceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 503 })
  }

  const serviceClient = await createServiceRoleClient()
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()
  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  try {
    const url = await createIntervalSwitchSession({
      customerId: profile.stripe_customer_id,
      targetPriceId,
      planPriceIds,
      returnUrl: absoluteUrl('/account'),
    })
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof IntervalSwitchError) {
      if (err.reason === 'already_on_price') {
        return NextResponse.json({ error: `You're already billed ${interval}.` }, { status: 409 })
      }
      if (err.reason === 'already_scheduled') {
        return NextResponse.json(
          { error: 'A billing change is already scheduled for the end of this term.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'No paid plan to switch' }, { status: 403 })
    }
    console.error('Interval switch error:', err)
    return NextResponse.json({ error: 'Failed to start the plan change' }, { status: 500 })
  }
}
