import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createBillingPortalSession } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'
import { limitBillingRequest } from '@/lib/billingRequestGuard'

/**
 * Opens a Stripe Billing Portal session, called from the extension via Bearer-token auth.
 * Mirrors /api/billing-portal but uses JWT auth instead of cookies because the extension
 * runs on a different origin. Requires a stripe_customer_id on the user's profile. Past the per-user
 * billing limit (limitBillingRequest() in lib/billingRequestGuard.ts) it answers 429 `rate_limited`
 * with `Retry-After`.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '')

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceRoleClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The same per-user billing limit as the web app's routes. No origin check: this route is
  // called by the extension with a Bearer token, not a cookie, so a cross-site page can't ride on it.
  const limited = await limitBillingRequest(user.id)
  if (limited) return limited

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 404 })
  }

  try {
    const url = await createBillingPortalSession({
      customerId: profile.stripe_customer_id,
      returnUrl: absoluteUrl('/dashboard'),
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error('Billing portal error:', err)
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 })
  }
}
