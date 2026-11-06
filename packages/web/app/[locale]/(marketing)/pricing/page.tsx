import { Suspense } from 'react'
import { pageMetadata } from '@/lib/seo'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { PricingTableForVisitor } from '@/components/pricing/PricingTableForVisitor'
import { CheckoutCanceledTracker } from '@/components/pricing/CheckoutCanceledTracker'
import { getStoreLinks } from '@/lib/storeLinks'
import { getVisitorBrowser } from '@/lib/visitorBrowser'

export async function generateMetadata() {
  const t = await getTranslations('pricing.page')
  return pageMetadata({ path: '/pricing', title: t('metaTitle'), description: t('metaDescription') })
}

export default async function PricingPage() {
  const t = await getTranslations('pricing.page')

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
