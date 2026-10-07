import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PricingTable } from '@/components/pricing/PricingTable'
import { getPriceInfo, type BillingInterval } from '@/lib/tiers'
import { hasCloudSync } from '@/lib/cloudSync'
import { getStoreLinks } from '@/lib/storeLinks'

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
  let currentInterval: BillingInterval | undefined
  if (user) {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('tier, status, stripe_price_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Same paid-plan rule as the rest of the product (active/trialing/past_due), not just 'active'.
    if (subscription && hasCloudSync(subscription)) {
      currentTier = subscription.tier
      // Resolved here: the Stripe price IDs are server-only env vars, undefined in the browser.
      currentInterval = getPriceInfo(subscription.stripe_price_id)?.interval
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
        <PricingTable
          currentTier={currentTier}
          currentInterval={currentInterval}
          installHref={getStoreLinks().chrome}
        />
      </div>
      <p className="text-center text-sm text-text2 mt-14">
        Have more questions? See the <Link href="/faq" className="text-primary hover:underline">FAQ</Link>.
      </p>
    </div>
  )
}
