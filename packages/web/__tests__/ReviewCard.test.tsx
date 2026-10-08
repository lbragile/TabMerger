import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ReviewCard, formatMonth } from '@/components/marketing/ReviewCard'
import type { StoreReview } from '@/lib/storeReviews'

const base: StoreReview = {
  quote: 'Works better and cleaner than OneTab',
  author: 'Anonymous reviewer',
  date: '2020-12-01T00:00:00Z',
  score: 5,
  url: 'https://addons.mozilla.org/firefox/addon/tabmerger/reviews/1634000/',
  store: 'firefox',
}

describe('ReviewCard', () => {
  it('renders the quote verbatim with its star score, author and date', () => {
    render(<ReviewCard review={base} />)
    expect(screen.getByText(/Works better and cleaner than OneTab/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '5 out of 5 stars' })).toHaveTextContent('★★★★★')
    expect(screen.getByText('Anonymous reviewer')).toBeInTheDocument()
    expect(screen.getByText('Dec 2020')).toBeInTheDocument()
  })

  it('shows a 4★ review as four filled stars, not five', () => {
    render(<ReviewCard review={{ ...base, score: 4 }} />)
    expect(screen.getByRole('img', { name: '4 out of 5 stars' })).toHaveTextContent('★★★★☆')
  })

  it('links to the full review on the store, in a new tab', () => {
    render(<ReviewCard review={base} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', base.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  describe('link text', () => {
    /** The words on screen: the link's own text, without the visually hidden parts. */
    const visibleText = (link: HTMLElement) =>
      Array.from(link.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join('')

    it.each([
      ['chrome', 'Chrome Web Store'],
      ['firefox', 'Firefox Add-ons'],
      // Decision: the same words for a store whose link opens its listing, not a single review.
      ['edge', 'Microsoft Edge Add-ons'],
    ] as const)('a %s card reads "Read full review", and names the reviewer and store for screen readers', (store, label) => {
      render(<ReviewCard review={{ ...base, store, author: 'Sample Person' }} />)
      const link = screen.getByRole('link')
      expect(visibleText(link)).toBe('Read full review')
      // Named by its content: the visible words, then the hidden ones.
      expect(link).not.toHaveAttribute('aria-label')
      expect(link.textContent).toBe(`Read full review by Sample Person on ${label} (opens in a new tab)`)
    })

    it('gives two cards from the same store different link names', () => {
      render(
        <>
          <ReviewCard review={{ ...base, author: 'First Person' }} />
          <ReviewCard review={{ ...base, author: 'Second Person' }} />
        </>,
      )
      const names = screen.getAllByRole('link').map((link) => link.textContent)
      expect(new Set(names).size).toBe(2)
    })

    it('keeps the extra words out of sight', () => {
      render(<ReviewCard review={base} />)
      const hidden = Array.from(screen.getByRole('link').querySelectorAll('span'))
      expect(hidden.map((span) => span.textContent)).toEqual([
        ' by Anonymous reviewer on Firefox Add-ons',
        ' (opens in a new tab)',
      ])
      for (const span of hidden) expect(span).toHaveClass('sr-only')
    })

    it('is always underlined, and keeps the browser focus outline', () => {
      render(<ReviewCard review={base} />)
      const link = screen.getByRole('link')
      expect(link.className).toMatch(/(^|\s)underline(\s|$)/)
      expect(link.className).not.toMatch(/hover:underline/)
      expect(link.className).not.toMatch(/outline-none/)
    })
  })

  it('marks the date up as a <time> with the full timestamp', () => {
    render(<ReviewCard review={base} />)
    const time = screen.getByText('Dec 2020')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', base.date)
  })

  it('is a list item for assistive tech', () => {
    render(<ReviewCard review={base} />)
    expect(screen.getByRole('listitem')).toHaveTextContent('Works better and cleaner than OneTab')
  })

  it('colours the stars with the star token, not the brand colour', () => {
    render(<ReviewCard review={base} />)
    const stars = screen.getByRole('img', { name: '5 out of 5 stars' })
    expect(stars.className).toContain('text-[hsl(var(--star))]')
    expect(stars.className).not.toMatch(/text-primary/)
  })

  it('never carries a lang attribute: the stores give no reliable language for a review', () => {
    const { container } = render(<ReviewCard review={{ ...base, quote: 'Sehr gut, danke.' }} />)
    expect(container.querySelector('[lang]')).toBeNull()
  })

  it('is no wider than the strip on a narrow screen, instead of a fixed width', () => {
    const { container } = render(<ReviewCard review={base} />)
    const card = container.firstElementChild as HTMLElement
    expect(card.className).toContain('w-[min(20rem,100cqw)]')
    expect(card.className).not.toMatch(/(^|\s)w-\[320px\]/)
  })

  it.each([
    ['chrome', 'Chrome Web Store'],
    ['firefox', 'Firefox Add-ons'],
    ['edge', 'Microsoft Edge Add-ons'],
  ] as const)('names the store a %s review came from in text', (store, label) => {
    render(<ReviewCard review={{ ...base, store }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it.each([
    ['chrome', 'Chrome'],
    ['firefox', 'Firefox'],
    ['edge', 'Edge'],
  ] as const)("shows the %s browser icon on the bottom line, hidden from assistive tech", (store, iconLabel) => {
    const { container } = render(<ReviewCard review={{ ...base, store }} />)
    const icon = container.querySelector(`svg[aria-label="${iconLabel}"]`)
    expect(icon).not.toBeNull()
    // Same line as the author and the link.
    expect(icon?.closest('p')).toContainElement(screen.getByRole('link'))
    // The store is already written out as text: the icon must not be announced as well.
    expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('img', { name: iconLabel })).not.toBeInTheDocument()
  })

  it('cuts a long author name with an ellipsis instead of wrapping, keeping the link whole', () => {
    const long = 'A Reviewer With A Remarkably Long Display Name Indeed'
    render(<ReviewCard review={{ ...base, author: long }} />)
    const name = screen.getByText(long)
    expect(name.className).toMatch(/\btruncate\b/)
    expect(name.className).toMatch(/\bmin-w-0\b/)
    // The whole name is still available: in the DOM for screen readers, in the title on hover.
    expect(name).toHaveAttribute('title', long)
    const link = screen.getByRole('link')
    expect(link.className).toMatch(/\bshrink-0\b/)
    // Same line: the name and the link are siblings in one flex row.
    expect(link.parentElement).toBe(name.parentElement)
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
    // Not an item of the list either: the list counts each review once.
    expect(container.firstElementChild).not.toHaveAttribute('role')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
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
