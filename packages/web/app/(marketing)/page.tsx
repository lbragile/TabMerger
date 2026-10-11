import { Suspense } from 'react'
import { Hero } from '@/components/marketing/Hero'
import { ReviewsStrip } from '@/components/marketing/ReviewsStrip'
import { ReviewsStripSkeleton } from '@/components/marketing/ReviewsStripSkeleton'
import { Features } from '@/components/marketing/Features'
import { PricingTeaser } from '@/components/marketing/PricingTeaser'
import { FinalCta } from '@/components/marketing/FinalCta'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'TabMerger — Organize your tabs. Reclaim your focus.',
}

export default function HomePage() {
  return (
    <>
      <Hero />
      {/* The reviews wait on three stores. Without this boundary the whole page waits with
          them; with it the page is sent at once and the section follows in the same
          response, a placeholder of the same size holding its place until then. */}
      <Suspense fallback={<ReviewsStripSkeleton />}>
        <ReviewsStrip />
      </Suspense>
      <Features />
      <PricingTeaser />
      <FinalCta />
    </>
  )
}
