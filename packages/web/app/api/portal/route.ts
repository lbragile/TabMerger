import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createBillingPortalSession } from '@/lib/stripe'
import { absoluteUrl } from '@/lib/utils'

/**
 * Opens a Stripe Billing Portal session, called from the extension via Bearer-token auth.
 * Mirrors /api/billing-portal but uses JWT auth instead of cookies because the extension
 * runs on a different origin. Requires a stripe_customer_id on the user's profile.
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
