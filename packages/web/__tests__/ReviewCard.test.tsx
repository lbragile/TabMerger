import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReviewCard, formatMonth } from '@/components/marketing/ReviewCard'

const base = {
  quote: 'Works better and cleaner than OneTab',
  author: 'Anonymous reviewer',
  date: '2020-12-01T00:00:00Z',
  score: 5,
  url: 'https://addons.mozilla.org/firefox/addon/tabmerger/reviews/1634000/',
}

describe('ReviewCard', () => {
  it('renders the quote verbatim with its star score, author and date', () => {
    render(<ReviewCard review={base} />)
    expect(screen.getByText(/Works better and cleaner than OneTab/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toHaveTextContent('★★★★★')
    expect(screen.getByText(/Anonymous reviewer · Dec 2020/)).toBeInTheDocument()
  })

  it('shows a 4★ review as four filled stars, not five', () => {
    render(<ReviewCard review={{ ...base, score: 4 }} />)
    expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toHaveTextContent('★★★★☆')
  })

  it('links to the full review on the store, in a new tab', () => {
    render(<ReviewCard review={base} />)
    const link = screen.getByRole('link', { name: 'Read full review' })
    expect(link).toHaveAttribute('href', base.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('clamps visually but keeps the full text in the DOM for screen readers', () => {
    const long = 'Great extension, genuinely. '.repeat(40).trim()
    const { container } = render(<ReviewCard review={{ ...base, quote: long }} />)
    expect(container.querySelector('.line-clamp-5')).not.toBeNull()
    expect(screen.getByText((t) => t.includes(long))).toBeInTheDocument()
  })

  it('has a fixed height so cards line up in the rotating track', () => {
    const { container } = render(<ReviewCard review={base} />)
    expect((container.firstElementChild as HTMLElement).className).toMatch(/\bh-\[\d+px\]/)
  })

  it('hides a loop-filler repeat from assistive tech and the tab order', () => {
    const { container } = render(<ReviewCard review={base} hidden />)
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('a')).toHaveAttribute('tabindex', '-1')
  })
})

describe('formatMonth', () => {
  it('formats in UTC, independent of the machine timezone', () => {
    // Midnight UTC on Dec 1 is still Nov 30 in every timezone west of UTC. This
    // rendered "Nov 2020" locally and "Dec 2020" on the server before the fix.
    expect(formatMonth('2020-12-01T00:00:00Z')).toBe('Dec 2020')
    expect(formatMonth('2021-01-01T00:30:00Z')).toBe('Jan 2021')
  })
})
