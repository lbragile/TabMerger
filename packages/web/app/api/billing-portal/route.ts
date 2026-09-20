import { NextResponse, type NextRequest } from 'next/server'
import { createBillingPortalSession } from '@/lib/stripe'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Opens a Stripe Billing Portal session so the user can manage or cancel their subscription.
 * Called by the dashboard account page (session-cookie auth). Requires an existing Stripe customer ID
 * on the profile; returns 400 if the user has never checked out (no billing account yet).
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const url = await createBillingPortalSession({
      customerId: profile.stripe_customer_id,
      returnUrl: (process.env.NEXT_PUBLIC_APP_URL ?? '') + '/dashboard',
    })

    return NextResponse.json({ url })
  } catch (err) {
    console.error('Billing portal error:', err)
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 })
  }
}
