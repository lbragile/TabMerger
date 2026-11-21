import { Suspense } from 'react'
import { FREE_TIER_LIMITS } from '@tabmerger/shared'
import { pageMetadata, pricingJsonLd } from '@/lib/seo'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { PricingTableForVisitor } from '@/components/pricing/PricingTableForVisitor'
import { CheckoutCanceledTracker } from '@/components/pricing/CheckoutCanceledTracker'
import { getStoreLinks } from '@/lib/storeLinks'
import { getVisitorBrowser } from '@/lib/visitorBrowser'
import { JsonLd } from '@/components/seo/JsonLd'
import { PageBreadcrumbJsonLd } from '@/components/seo/PageBreadcrumbJsonLd'

export async function generateMetadata() {
  const t = await getTranslations('pricing.page')
  return pageMetadata({
    path: '/pricing',
    title: t('metaTitle'),
    description: t('metaDescription', { groups: FREE_TIER_LIMITS.groups, tabs: FREE_TIER_LIMITS.tabs }),
  })
}

export default async function PricingPage() {
  const [t, nav, meta] = await Promise.all([
    getTranslations('pricing.page'),
    getTranslations('nav'),
    getTranslations('metadata'),
  ])

  return (
    <div className="py-16">
      {/* The plans on sale, at the prices the table below shows (both read PRICING_TIERS). */}
      <JsonLd data={pricingJsonLd(meta('siteDescription'))} />
      <PageBreadcrumbJsonLd path="/pricing" name={nav('pricing')} />
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
        {/* The visitor's plan is read in the browser: this page reads no session on the server. */}
        <PricingTableForVisitor installHref={getStoreLinks()[await getVisitorBrowser()]} />
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
