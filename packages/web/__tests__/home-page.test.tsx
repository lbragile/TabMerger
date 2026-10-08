import { Children, isValidElement, Suspense, type ReactElement, type ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HomePage from '@/app/(marketing)/page'
import { ReviewsStrip } from '@/components/marketing/ReviewsStrip'
import { ReviewsStripSkeleton } from '@/components/marketing/ReviewsStripSkeleton'

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

  // The reviews wait on three stores. Outside a Suspense boundary the whole page waits
  // with them; inside one the rest of the page is sent first.
  describe('reviews section streaming', () => {
    type Props = { children?: ReactNode; fallback?: ReactNode }
    const sections = () => {
      const page = HomePage() as ReactElement<Props>
      return Children.toArray(page.props.children).filter(isValidElement) as ReactElement<Props>[]
    }

    it('wraps the reviews section, and only it, in a Suspense boundary', () => {
      const boundaries = sections().filter((el) => el.type === Suspense)
      expect(boundaries).toHaveLength(1)
      const inside = Children.toArray(boundaries[0].props.children).filter(isValidElement) as ReactElement[]
      expect(inside.map((el) => el.type)).toEqual([ReviewsStrip])
      // Nothing else is held back with it.
      expect(sections().some((el) => el.type === ReviewsStrip)).toBe(false)
    })

    it('shows the skeleton while the reviews load', () => {
      const [boundary] = sections().filter((el) => el.type === Suspense)
      const fallback = boundary.props.fallback
      expect(isValidElement(fallback) && fallback.type).toBe(ReviewsStripSkeleton)
    })

    it('keeps the section where it was on the page: after the hero, before the features', () => {
      render(<HomePage />)
      const text = document.body.textContent ?? ''
      expect(text.indexOf('hero')).toBeLessThan(text.indexOf('reviews'))
      expect(text.indexOf('reviews')).toBeLessThan(text.indexOf('features'))
    })
  })
})
