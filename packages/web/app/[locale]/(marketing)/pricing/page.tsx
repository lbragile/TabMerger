import { Suspense } from 'react'
import { pageMetadata } from '@/lib/seo'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { PricingTable } from '@/components/pricing/PricingTable'
import { CheckoutCanceledTracker } from '@/components/pricing/CheckoutCanceledTracker'
import { getPriceInfo, type BillingInterval } from '@/lib/tiers'
import { hasCloudSync } from '@/lib/cloudSync'
import { getStoreLinks } from '@/lib/storeLinks'
import { getVisitorBrowser } from '@/lib/visitorBrowser'

export async function generateMetadata() {
  const t = await getTranslations('pricing.page')
  return pageMetadata({ path: '/pricing', title: t('metaTitle'), description: t('metaDescription') })
}

export default async function PricingPage() {
  const supabase = await createClient()
  const t = await getTranslations('pricing.page')
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
      {/* Counts a checkout Stripe sent back via cancel_url, then strips the marker from the URL. */}
      <Suspense fallback={null}>
        <CheckoutCanceledTracker />
      </Suspense>
      <div className="container">
        <div className="text-center mb-14">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-4 text-xl text-muted-foreground">
            {t('lead')}
          </p>
        </div>
        <PricingTable
          currentTier={currentTier}
          currentInterval={currentInterval}
          installHref={getStoreLinks()[await getVisitorBrowser()]}
        />
      </div>
      <p className="text-center text-sm text-text2 mt-14">
        {t.rich('moreQuestions', {
          link: (chunks) => (
            <Link href="/faq" className="text-primary underline underline-offset-2">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  )
}
