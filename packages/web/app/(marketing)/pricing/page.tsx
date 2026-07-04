import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { PricingTable } from '@/components/pricing/PricingTable'
import { FAQ } from '@/components/marketing/FAQ'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple, transparent pricing. Start free, upgrade when you need more.',
}

export default async function PricingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let currentTier = 'free'
  if (user) {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('tier')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single()

    if (subscription?.tier) {
      currentTier = subscription.tier
    }
  }

  return (
    <div className="py-16">
      <div className="container">
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-xl text-muted-foreground">
            Start free. Upgrade when you&apos;re ready for more.
          </p>
        </div>
        <PricingTable currentTier={currentTier} />
      </div>
      <div className="mt-16">
        <FAQ />
      </div>
    </div>
  )
}
