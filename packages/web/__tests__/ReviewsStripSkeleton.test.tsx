import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReviewsStripSkeleton } from '@/components/marketing/ReviewsStripSkeleton'
import { CARD_BOX_CLASS } from '@/components/marketing/reviewsLayout'

describe('ReviewsStripSkeleton', () => {
  it('shows the real section heading straight away: it needs no data', () => {
    render(<ReviewsStripSkeleton />)
    expect(screen.getByRole('heading', { level: 2, name: 'What people are saying' })).toBeInTheDocument()
  })

  it('marks the section as busy and says what it is waiting for, once, in text', () => {
    render(<ReviewsStripSkeleton />)
    const section = screen.getByTestId('reviews-skeleton')
    expect(section.tagName).toBe('SECTION')
    expect(section).toHaveAttribute('aria-busy', 'true')
    const loading = screen.getByText('Loading reviews')
    expect(loading).toHaveClass('sr-only')
    expect(loading.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('hides every placeholder from assistive tech', () => {
    render(<ReviewsStripSkeleton />)
    const section = screen.getByTestId('reviews-skeleton')
    const placeholders = section.querySelectorAll('.animate-pulse')
    expect(placeholders.length).toBeGreaterThan(10)
    for (const placeholder of placeholders) {
      expect(placeholder.closest('[aria-hidden="true"]')).not.toBeNull()
    }
    // Nothing a screen reader can reach but the heading and the loading text.
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('is not a live region, so the reviews replacing it are not announced', () => {
    const { container } = render(<ReviewsStripSkeleton />)
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  })

  it('has nothing that can take focus', () => {
    const { container } = render(<ReviewsStripSkeleton />)
    expect(container.querySelector('a, button, input, [tabindex]')).toBeNull()
  })

  it('stops pulsing under reduced motion', () => {
    render(<ReviewsStripSkeleton />)
    for (const placeholder of screen.getByTestId('reviews-skeleton').querySelectorAll('.animate-pulse')) {
      expect(placeholder).toHaveClass('motion-reduce:animate-none')
    }
  })

  it('holds the place of three store tiles and a row of cards at the real card size', () => {
    render(<ReviewsStripSkeleton />)
    const section = screen.getByTestId('reviews-skeleton')
    expect(section.querySelectorAll('.sm\\:grid-cols-3 > *')).toHaveLength(3)

    const cards = Array.from(section.querySelectorAll('div')).filter((el) =>
      CARD_BOX_CLASS.split(' ').every((cls) => el.classList.contains(cls)),
    )
    // Enough to fill a 2560px-wide screen at 336px a card.
    expect(cards.length).toBeGreaterThanOrEqual(8)
  })
})
