import { Suspense } from 'react'
import { pageMetadata } from '@/lib/seo'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { PricingTable } from '@/components/pricing/PricingTable'
import { CheckoutCanceledTracker } from '@/components/pricing/CheckoutCanceledTracker'
import { getCurrentPlan } from '@/lib/currentPlan'
import { getStoreLinks } from '@/lib/storeLinks'
import { getVisitorBrowser } from '@/lib/visitorBrowser'

export async function generateMetadata() {
  const t = await getTranslations('pricing.page')
  return pageMetadata({ path: '/pricing', title: t('metaTitle'), description: t('metaDescription') })
}

export default async function PricingPage() {
  const t = await getTranslations('pricing.page')
  // Guests and free accounts both come back as 'free'; `signedIn` tells them apart.
  const plan = await getCurrentPlan()

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
          currentTier={plan.tier}
          currentInterval={plan.interval}
          currentAiMode={plan.aiMode}
          currentPeriodEnd={plan.periodEnd}
          installHref={getStoreLinks()[await getVisitorBrowser()]}
          signedIn={plan.signedIn}
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
