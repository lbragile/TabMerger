import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ReviewsStrip } from '@/components/marketing/ReviewsStrip'
import { getChromeStoreStats } from '@/lib/chromeStoreStats'

vi.mock('@/lib/chromeStoreStats', () => ({
  getChromeStoreStats: vi.fn(),
}))

describe('ReviewsStrip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('still renders the review marquee (not the numeric stats block) when store stats are unavailable', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue(null)
    const jsx = await ReviewsStrip()
    render(<>{jsx}</>)
    // No fabricated numbers …
    expect(screen.queryByText('Chrome Web Store rating')).not.toBeInTheDocument()
    // … but the static testimonial marquee always shows.
    expect(screen.getAllByText(/TabMerger saved my sanity/i).length).toBeGreaterThan(0)
  })

  it('renders real stats when available', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue({ rating: 4.8, ratingCount: 2400 })
    const jsx = await ReviewsStrip()
    render(<>{jsx}</>)
    expect(screen.getByText('4.8 / 5')).toBeInTheDocument()
    expect(screen.getByText('2,400')).toBeInTheDocument()
    expect(screen.getByText('Chrome Web Store rating')).toBeInTheDocument()
  })

  it('renders the marquee alongside the numeric stats block when stats are available', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue({ rating: 4.8, ratingCount: 2400 })
    const jsx = await ReviewsStrip()
    render(<>{jsx}</>)
    expect(screen.getByText('Chrome Web Store rating')).toBeInTheDocument()
    // Review list is duplicated once for the seamless loop, so each attribution appears twice.
    expect(screen.getAllByText('ALEX T. · Chrome Web Store').length).toBe(2)
    expect(screen.getAllByText('JORDAN K. · Chrome Web Store').length).toBe(2)
  })

  it('uses a responsive grid class instead of an unconditional 3-column layout', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue({ rating: 4.8, ratingCount: 2400 })
    const jsx = await ReviewsStrip()
    const { container } = render(<>{jsx}</>)
    const gridEl = container.querySelector('.grid') as HTMLElement | null
    expect(gridEl).not.toBeNull()
    expect(gridEl?.className).not.toMatch(/^grid grid-cols-3\b/)
    expect(gridEl?.className).toMatch(/\b(sm|md|lg):grid-cols-/)
  })

  it('renders a 5-star rating row on each review card', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue(null)
    const jsx = await ReviewsStrip()
    render(<>{jsx}</>)
    const stars = screen.getAllByLabelText('5 out of 5 stars')
    expect(stars.length).toBeGreaterThan(0)
    stars.forEach((el) => expect(el).toHaveTextContent('★★★★★'))
  })

  it('renders initials avatars derived from the reviewer name', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue(null)
    const jsx = await ReviewsStrip()
    render(<>{jsx}</>)
    expect(screen.getAllByText('AT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('JK').length).toBeGreaterThan(0)
  })

  it('renders the "Loved by thousands of tab-drowning users" heading', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue(null)
    const jsx = await ReviewsStrip()
    render(<>{jsx}</>)
    expect(
      screen.getByRole('heading', { name: 'Loved by thousands of tab-drowning users' })
    ).toBeInTheDocument()
  })
})
