import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ReviewsStrip, buildMarqueeTrack } from '@/components/marketing/ReviewsStrip'
import { getChromeStoreStats } from '@/lib/chromeStoreStats'
import { getFirefoxAddonStats } from '@/lib/firefoxAddonStats'

vi.mock('@/lib/chromeStoreStats', () => ({ getChromeStoreStats: vi.fn() }))
vi.mock('@/lib/firefoxAddonStats', () => ({ getFirefoxAddonStats: vi.fn() }))

const chrome = { rating: 4.5, ratingCount: 3600 }
const firefox = {
  rating: 3.9,
  ratingCount: 15,
  reviews: [
    { quote: 'Works better and cleaner than OneTab', author: 'Anonymous reviewer', date: '2020-12-01T00:00:00Z', score: 5, url: 'https://example.test/reviews/1/' },
    { quote: 'Found TabMerger really helpful in organizing several tabs.', author: 'Namsakhi', date: '2021-01-05T00:00:00Z', score: 5, url: 'https://example.test/reviews/2/' },
  ],
}

async function renderStrip() {
  const jsx = await ReviewsStrip()
  return render(<>{jsx}</>)
}

// This component used to render four invented testimonials ("TabMerger saved my
// sanity" — "ALEX T. · Chrome Web Store", …) and these tests used to assert they
// were always present. Everything rendered now must come from a live listing.
describe('ReviewsStrip', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('source selection', () => {
    it('prefers the Chrome Web Store and does not query Firefox', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(chrome)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      await renderStrip()
      expect(screen.getByText('4.5 / 5')).toBeInTheDocument()
      expect(getFirefoxAddonStats).not.toHaveBeenCalled()
    })

    it('falls back to Firefox Add-ons data when the Chrome listing yields nothing', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      await renderStrip()
      expect(screen.getByText('3.9 / 5')).toBeInTheDocument()
      expect(screen.getByText('15')).toBeInTheDocument()
    })

    it('renders nothing when neither store has data', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(null)
      const { container } = await renderStrip()
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('labelling', () => {
    it('uses store-neutral stat labels', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      await renderStrip()
      expect(screen.getByText('Average rating')).toBeInTheDocument()
      expect(screen.getByText('Ratings')).toBeInTheDocument()
    })

    it('never mentions Firefox in the visible text on the fallback path', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      const { container } = await renderStrip()
      // Visible text only — the "Read full review" links do point at the store.
      expect(container.textContent).not.toMatch(/firefox/i)
    })

    it('never labels Firefox figures as Chrome ones', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      const { container } = await renderStrip()
      expect(container.textContent).not.toMatch(/chrome/i)
    })
  })

  describe('rotation', () => {
    it('always renders the review carousel when there are reviews, even only a few', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      await renderStrip()
      expect(screen.getByRole('region', { name: 'Reviews' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous review' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next review' })).toBeInTheDocument()
    })

    it('exposes each review to assistive tech exactly once despite the repeats', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(null)
      vi.mocked(getFirefoxAddonStats).mockResolvedValue(firefox)
      await renderStrip()
      // Hidden repeats are aria-hidden, so role queries only see the originals.
      expect(screen.getAllByRole('img', { name: '5 out of 5 stars' })).toHaveLength(firefox.reviews.length)
    })

    it('shows stats without a carousel when the source has no reviews', async () => {
      vi.mocked(getChromeStoreStats).mockResolvedValue(chrome)
      await renderStrip()
      expect(screen.getByText('Average rating')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Reviews' })).not.toBeInTheDocument()
    })
  })

  it('never renders the invented testimonials this component used to ship', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue(chrome)
    await renderStrip()
    for (const fake of [/saved my sanity/i, /genuinely magic/i, /ALEX T\./, /PRIYA S\./, /MARCO L\./, /JORDAN K\./, /Loved by thousands/i]) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument()
    }
  })
})

describe('buildMarqueeTrack', () => {
  const STRIDE = 336
  const halfWidth = (n: number) => n * STRIDE

  it('returns an empty track for no items', () => {
    expect(buildMarqueeTrack([])).toEqual([])
  })

  it('is two identical halves — required by the carousel wrapping at half its width', () => {
    const track = buildMarqueeTrack(['a', 'b', 'c'])
    const half = track.length / 2
    expect(track.slice(0, half)).toEqual(track.slice(half))
  })

  it.each([1, 2, 3, 7, 12])('makes each half wide enough to cover a 2560px viewport with %i unique items', (n) => {
    const track = buildMarqueeTrack(Array.from({ length: n }, (_, i) => i))
    expect(halfWidth(track.length / 2)).toBeGreaterThanOrEqual(2560)
  })

  it('preserves order within each repeat', () => {
    expect(buildMarqueeTrack(['a', 'b']).slice(0, 4)).toEqual(['a', 'b', 'a', 'b'])
  })
})
