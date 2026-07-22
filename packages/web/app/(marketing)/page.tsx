import { Hero } from '@/components/marketing/Hero'
import { ReviewsStrip } from '@/components/marketing/ReviewsStrip'
import { Features } from '@/components/marketing/Features'
import { Testimonials } from '@/components/marketing/Testimonials'
import { FAQ } from '@/components/marketing/FAQ'
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
      <Testimonials />
      <FAQ />
    </>
  )
}
