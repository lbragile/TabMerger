import { Hero } from '@/components/marketing/Hero'
import { ReviewsStrip } from '@/components/marketing/ReviewsStrip'
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
      <ReviewsStrip />
      <Features />
      <PricingTeaser />
      <FinalCta />
    </>
  )
}
