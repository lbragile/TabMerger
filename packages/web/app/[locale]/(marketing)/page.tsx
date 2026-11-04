import { Suspense } from 'react'
import { Hero } from '@/components/marketing/Hero'
import { ReviewsStrip } from '@/components/marketing/ReviewsStrip'
import { ReviewsStripSkeleton } from '@/components/marketing/ReviewsStripSkeleton'
import { Features } from '@/components/marketing/Features'
import { PricingTeaserForVisitor } from '@/components/marketing/PricingTeaser'
import { getCurrentPlan, GUEST_PLAN } from '@/lib/currentPlan'
import { FinalCta } from '@/components/marketing/FinalCta'
import { JsonLd } from '@/components/seo/JsonLd'
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { getVisitorBrowser } from '@/lib/visitorBrowser'
import { homeJsonLd, pageMetadata } from '@/lib/seo'

// Absolute: the root layout's title template would otherwise append the brand a second time.
export async function generateMetadata() {
  const t = await getTranslations('metadata')
  return pageMetadata({ path: '/', title: t('homeTitle'), description: t('siteDescription'), absoluteTitle: true })
}

/** The homepage's structured data, described in the request's language. */
function HomeJsonLd() {
  const t = useTranslations('metadata')
  return <JsonLd data={homeJsonLd(t('siteDescription'))} />
}

export default async function HomePage() {
  // Server side, so the first HTML already leads with the visitor's browser (no reorder flash).
  const browser = await getVisitorBrowser()
  // Started, not awaited: the page is sent straight away and the pricing teaser's badge follows
  // the signed-in plan when it arrives. A failed lookup shows the teaser as for a guest.
  const planPromise = getCurrentPlan().catch(() => GUEST_PLAN)

  return (
    <>
      <HomeJsonLd />
      <Hero browser={browser} />
      {/* The reviews wait on three stores. Without this boundary the whole page waits with
          them; with it the page is sent at once and the section follows in the same
          response, a placeholder of the same size holding its place until then. */}
      <Suspense fallback={<ReviewsStripSkeleton />}>
        <ReviewsStrip />
      </Suspense>
      <Features />
      <PricingTeaserForVisitor planPromise={planPromise} />
      <FinalCta browser={browser} />
    </>
  )
}
