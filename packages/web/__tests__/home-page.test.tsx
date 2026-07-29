import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HomePage from '@/app/(marketing)/page'

vi.mock('@/components/marketing/Hero', () => ({ Hero: () => <div>hero</div> }))
vi.mock('@/components/marketing/ReviewsStrip', () => ({ ReviewsStrip: () => <div>reviews</div> }))
vi.mock('@/components/marketing/Features', () => ({ Features: () => <div>features</div> }))
vi.mock('@/components/marketing/PricingTeaser', () => ({ PricingTeaser: () => <div>pricing-teaser</div> }))
vi.mock('@/components/marketing/FinalCta', () => ({ FinalCta: () => <div>final-cta</div> }))

describe('HomePage', () => {
  it('no longer renders the removed Testimonials section', () => {
    render(<HomePage />)

    // Testimonials.tsx was deleted in favor of the ReviewsStrip marquee — its
    // review-attribution copy must never appear on the home page.
    expect(screen.queryByText(/ALEX T\./i)).not.toBeInTheDocument()
    expect(screen.queryByText('hero')).toBeInTheDocument()
    expect(screen.queryByText('reviews')).toBeInTheDocument()
    expect(screen.queryByText('features')).toBeInTheDocument()
  })

  it('renders the PricingTeaser and FinalCta sections after Features', () => {
    render(<HomePage />)
    expect(screen.queryByText('pricing-teaser')).toBeInTheDocument()
    expect(screen.queryByText('final-cta')).toBeInTheDocument()
  })
})
