import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReviewsStrip, buildMarqueeTrack, listNames } from '@/components/marketing/ReviewsStrip'
import { getChromeStoreStats } from '@/lib/chromeStoreStats'
import { getEdgeAddonStats } from '@/lib/edgeAddonStats'
import { getFirefoxAddonStats } from '@/lib/firefoxAddonStats'
import { STABLE_STORE_LINKS } from '@/lib/storeLinks'
import type { StoreRatingStats } from '@/lib/storeReviews'

vi.mock('@/lib/chromeStoreStats', () => ({ getChromeStoreStats: vi.fn() }))
vi.mock('@/lib/firefoxAddonStats', () => ({ getFirefoxAddonStats: vi.fn() }))
vi.mock('@/lib/edgeAddonStats', () => ({ getEdgeAddonStats: vi.fn() }))

// Invented reviewers and text. The figures mirror the shape of real ones: the stores'
// unrounded means, which is what the modules return.
const chrome: StoreRatingStats = {
  rating: 4.571428571428571,
  ratingCount: 28,
  reviews: [
    { quote: 'Chrome review number one, tidy and quick.', author: 'Sample Person', date: '2021-10-20T00:00:00.000Z', score: 5, url: 'https://example.test/chrome/reviews', store: 'chrome' },
    { quote: 'Chrome review number two, does the job.', author: 'Another Tester', date: '2021-03-08T00:00:00.000Z', score: 4, url: 'https://example.test/chrome/reviews', store: 'chrome' },
  ],
}
const firefox: StoreRatingStats = {
  rating: 3.9333,
  ratingCount: 15,
  reviews: [
    { quote: 'Firefox review number one, works better and cleaner.', author: 'Anonymous reviewer', date: '2020-12-01T00:00:00Z', score: 5, url: 'https://example.test/firefox/reviews/1/', store: 'firefox' },
    { quote: 'Firefox review number two, really helpful for many tabs.', author: 'Example Reviewer', date: '2021-01-05T00:00:00Z', score: 5, url: 'https://example.test/firefox/reviews/2/', store: 'firefox' },
  ],
}
const edge: StoreRatingStats = {
  rating: 3,
  ratingCount: 4,
  reviews: [
    { quote: 'Edge review number one, handy for big sessions.', author: 'Third Example', date: '2021-02-25T06:08:45.439Z', score: 5, url: 'https://example.test/edge/listing', store: 'edge' },
  ],
}

function mockStores(stores: { chrome?: StoreRatingStats | null; firefox?: StoreRatingStats | null; edge?: StoreRatingStats | null }) {
  vi.mocked(getChromeStoreStats).mockResolvedValue(stores.chrome ?? null)
  vi.mocked(getFirefoxAddonStats).mockResolvedValue(stores.firefox ?? null)
  vi.mocked(getEdgeAddonStats).mockResolvedValue(stores.edge ?? null)
}

async function renderStrip() {
  const jsx = await ReviewsStrip()
  return render(<>{jsx}</>)
}

/**
 * What a screen reader is given for an element named by its content: its text, minus
 * anything hidden from assistive tech. (Compared as text rather than with
 * toHaveAccessibleName, whose name computation drops the spaces at the edges of each
 * nested element, which no browser does.)
 */
function spokenText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove())
  return clone.textContent ?? ''
}

/**
 * The headline rating. It is written "4.23 / 5": the figure, then "/ 5" hidden from
 * assistive tech and "out of 5" hidden from sight. Returns what each audience gets.
 */
function headlineRating(figure: string) {
  const el = screen.getByText(figure)
  const shown = Array.from(el.childNodes)
    .filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only')))
    .map((node) => node.textContent)
    .join('')
  const spoken = Array.from(el.childNodes)
    .filter((node) => !(node instanceof HTMLElement && node.getAttribute('aria-hidden') === 'true'))
    .map((node) => node.textContent)
    .join('')
  return { shown, spoken }
}

// This component used to render four invented testimonials ("TabMerger saved my
// sanity" — "ALEX T. · Chrome Web Store", …) and these tests used to assert they
// were always present. Everything rendered now must come from a live listing.
describe('ReviewsStrip', () => {
  // Every test states what each store returns: nothing carries over from the one before.
  beforeEach(() => mockStores({}))

  describe('headline figures', () => {
    it('combines every store: the count-weighted mean and the total number of ratings', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      // (4.5714 × 28 + 3.9333 × 15 + 3 × 4) / 47 = 4.234 — the mean of all 47 ratings.
      expect(headlineRating('4.23').shown).toBe('4.23 / 5')
      expect(screen.getByText('47')).toBeInTheDocument()
      expect(screen.getByText('Average rating')).toBeInTheDocument()
      expect(screen.getByText('Ratings across Chrome, Firefox and Edge')).toBeInTheDocument()
    })

    it('reads the rating to a screen reader as "out of 5", not as a slash', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      expect(headlineRating('4.23').spoken).toBe('4.23 out of 5')
    })

    it('queries the three stores every time', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      expect(getChromeStoreStats).toHaveBeenCalled()
      expect(getFirefoxAddonStats).toHaveBeenCalled()
      expect(getEdgeAddonStats).toHaveBeenCalled()
    })

    it('names only the stores that returned data', async () => {
      mockStores({ firefox, edge })
      const { container } = await renderStrip()
      // (3.9333 × 15 + 3 × 4) / 19 = 3.737
      expect(headlineRating('3.74').shown).toBe('3.74 / 5')
      expect(screen.getByText('19')).toBeInTheDocument()
      expect(screen.getByText('Ratings across Firefox and Edge')).toBeInTheDocument()
      expect(container.textContent).not.toMatch(/chrome/i)
    })

    it('still shows the other stores when one of them throws', async () => {
      mockStores({ firefox, edge })
      vi.mocked(getChromeStoreStats).mockRejectedValue(new Error('store down'))
      await renderStrip()
      expect(screen.getByText('Ratings across Firefox and Edge')).toBeInTheDocument()
    })

    it('shows a single store under its own name, with no breakdown', async () => {
      mockStores({ firefox })
      const { container } = await renderStrip()
      expect(headlineRating('3.93').shown).toBe('3.93 / 5')
      expect(screen.getByText('15')).toBeInTheDocument()
      expect(screen.getByText('Average rating on Firefox Add-ons')).toBeInTheDocument()
      expect(screen.getByText('Ratings on Firefox Add-ons')).toBeInTheDocument()
      expect(screen.queryByRole('list', { name: 'By store' })).not.toBeInTheDocument()
      expect(screen.queryByText('By store')).not.toBeInTheDocument()
      // A figure must never sit under the wrong store's name.
      expect(container.textContent).not.toMatch(/chrome|edge/i)
    })

    it('renders nothing when no store has data', async () => {
      const { container } = await renderStrip()
      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('per-store breakdown', () => {
    const tiles = () => within(screen.getByRole('list', { name: 'By store' })).getAllByRole('link')

    it("shows one tile per store with that store's own rating and count", async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      // The accessible name is the visible text in the order shown, with the gaps spoken.
      const [chromeTile, firefoxTile, edgeTile] = tiles()
      expect(spokenText(chromeTile)).toBe('Chrome Web Store, 28 ratings, 4.57 out of 5 (opens in a new tab)')
      expect(spokenText(firefoxTile)).toBe('Firefox Add-ons, 15 ratings, 3.93 out of 5 (opens in a new tab)')
      expect(spokenText(edgeTile)).toBe('Microsoft Edge Add-ons, 4 ratings, 3.00 out of 5 (opens in a new tab)')
      expect(within(chromeTile).getByText('Chrome Web Store')).toBeInTheDocument()
      expect(within(chromeTile).getByText('4.57')).toBeInTheDocument()
      expect(within(chromeTile).getByText('28 ratings')).toBeInTheDocument()
    })

    it('names a tile by its visible text, with no aria-label to replace it', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      for (const tile of tiles()) {
        expect(tile).not.toHaveAttribute('aria-label')
        // "/ 5" is for the eye only; a screen reader gets "out of 5" in its place.
        const slash = within(tile).getByText('/ 5')
        expect(slash).toHaveAttribute('aria-hidden', 'true')
        expect(within(tile).getByText('out of 5')).toHaveClass('sr-only')
      }
    })

    it('keeps list semantics where the CSS reset removes them', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      const list = screen.getByRole('list', { name: 'By store' })
      expect(list.tagName).toBe('UL')
      expect(list).toHaveAttribute('role', 'list')
      expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    })

    it('uses a focus ring in the text colour, not the brand colour', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      for (const tile of tiles()) {
        expect(tile.className).toMatch(/focus-visible:ring-foreground/)
        expect(tile.className).not.toMatch(/ring-primary/)
      }
    })

    it("links each tile to that store's stable listing, in a new tab", async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      expect(tiles().map((tile) => tile.getAttribute('href'))).toEqual([
        STABLE_STORE_LINKS.chrome,
        STABLE_STORE_LINKS.firefox,
        STABLE_STORE_LINKS.edge,
      ])
      for (const tile of tiles()) {
        expect(tile).toHaveAttribute('target', '_blank')
        expect(tile).toHaveAttribute('rel', 'noopener noreferrer')
      }
    })

    it('shows each browser icon as decoration: the store is named in text', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      for (const tile of tiles()) {
        const icon = tile.querySelector('svg')
        expect(icon).not.toBeNull()
        expect(icon?.closest('[aria-hidden="true"]')).not.toBeNull()
      }
    })

    it('shows two tiles when two stores returned data', async () => {
      mockStores({ chrome, firefox })
      await renderStrip()
      expect(tiles()).toHaveLength(2)
      expect(spokenText(tiles()[0])).toBe('Chrome Web Store, 28 ratings, 4.57 out of 5 (opens in a new tab)')
      expect(spokenText(tiles()[1])).toBe('Firefox Add-ons, 15 ratings, 3.93 out of 5 (opens in a new tab)')
    })

    it('writes a single rating in the singular', async () => {
      mockStores({ firefox, edge: { rating: 5, ratingCount: 1, reviews: [] } })
      await renderStrip()
      const edgeTile = tiles()[1]
      expect(spokenText(edgeTile)).toBe('Microsoft Edge Add-ons, 1 rating, 5.00 out of 5 (opens in a new tab)')
      expect(within(edgeTile).getByText('1 rating')).toBeInTheDocument()
    })
  })

  describe('carousel', () => {
    const visibleCards = () =>
      Array.from(screen.getByTestId('reviews-track').children).filter((card) => !card.hasAttribute('aria-hidden')) as HTMLElement[]

    const STORE_NAME = /^(Chrome Web Store|Firefox Add-ons|Microsoft Edge Add-ons)$/

    it('mixes the reviews of every store that supplied texts, spread out rather than in blocks', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      const cards = visibleCards()
      expect(cards).toHaveLength(5)
      // Two Chrome, two Firefox, one Edge: the single Edge review sits in the middle.
      expect(cards.map((card) => within(card).getByText(STORE_NAME).textContent)).toEqual([
        'Chrome Web Store',
        'Firefox Add-ons',
        'Microsoft Edge Add-ons',
        'Chrome Web Store',
        'Firefox Add-ons',
      ])
    })

    it('alternates strictly between two stores with the same number of reviews', async () => {
      mockStores({ chrome, firefox })
      await renderStrip()
      expect(visibleCards().map((card) => within(card).getByText(STORE_NAME).textContent)).toEqual([
        'Chrome Web Store',
        'Firefox Add-ons',
        'Chrome Web Store',
        'Firefox Add-ons',
      ])
    })

    it('links each card to the store its review came from', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      const path: Record<string, string> = {
        'Chrome Web Store': '/chrome/',
        'Firefox Add-ons': '/firefox/',
        'Microsoft Edge Add-ons': '/edge/',
      }
      for (const card of visibleCards()) {
        const store = within(card).getByText(STORE_NAME).textContent ?? ''
        const href = within(card).getByRole('link').getAttribute('href')
        expect(href).toContain(path[store])
      }
    })

    it('always renders the review carousel when there are reviews, even only a few', async () => {
      mockStores({ firefox })
      await renderStrip()
      // Named by the section's heading.
      expect(screen.getByRole('heading', { level: 2, name: 'What people are saying' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'What people are saying' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous review' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next review' })).toBeInTheDocument()
    })

    it('gives every link the same visible words, and tells a screen reader whose review and which store', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      const names = visibleCards().map((card) => within(card).getByRole('link').textContent)
      expect(names).toEqual([
        'Read full review by Sample Person on Chrome Web Store (opens in a new tab)',
        'Read full review by Anonymous reviewer on Firefox Add-ons (opens in a new tab)',
        'Read full review by Third Example on Microsoft Edge Add-ons (opens in a new tab)',
        'Read full review by Another Tester on Chrome Web Store (opens in a new tab)',
        'Read full review by Example Reviewer on Firefox Add-ons (opens in a new tab)',
      ])
    })

    it('is a list with one item per review, the repeats left out', async () => {
      mockStores({ chrome, firefox, edge })
      await renderStrip()
      const track = screen.getByTestId('reviews-track')
      expect(track).toHaveAttribute('role', 'list')
      expect(within(track).getAllByRole('listitem')).toHaveLength(5)
      // Every repeat is hidden and out of the tab order.
      const repeats = Array.from(track.children).filter((card) => card.getAttribute('aria-hidden') === 'true')
      expect(repeats.length).toBe(track.children.length - 5)
      for (const repeat of repeats) {
        expect(repeat).not.toHaveAttribute('role')
        expect(repeat.querySelector('a')).toHaveAttribute('tabindex', '-1')
      }
    })

    it('has no live region: the strip moving must not be announced', async () => {
      mockStores({ chrome, firefox, edge })
      const { container } = await renderStrip()
      expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
    })

    it('exposes each review to assistive tech exactly once despite the repeats', async () => {
      mockStores({ firefox })
      await renderStrip()
      // Hidden repeats are aria-hidden, so role queries only see the originals.
      expect(screen.getAllByRole('img', { name: '5 out of 5 stars' })).toHaveLength(firefox.reviews.length)
    })

    it('shows the figures without a carousel when no store supplied review texts', async () => {
      mockStores({ chrome: { ...chrome, reviews: [] }, edge: { ...edge, reviews: [] } })
      await renderStrip()
      expect(screen.getByText('Average rating')).toBeInTheDocument()
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })
  })

  it('never renders the invented testimonials this component used to ship', async () => {
    mockStores({ chrome, firefox, edge })
    await renderStrip()
    for (const fake of [/saved my sanity/i, /genuinely magic/i, /ALEX T\./, /PRIYA S\./, /MARCO L\./, /JORDAN K\./, /Loved by thousands/i]) {
      expect(screen.queryByText(fake)).not.toBeInTheDocument()
    }
  })
})

describe('listNames', () => {
  it.each([
    [['Chrome'], 'Chrome'],
    [['Chrome', 'Firefox'], 'Chrome and Firefox'],
    [['Chrome', 'Firefox', 'Edge'], 'Chrome, Firefox and Edge'],
  ])('joins %j as %j', (names, expected) => {
    expect(listNames(names)).toBe(expected)
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

  // On a 320px screen the card is 272px and the stride 288px. 8 and 9 items are counts that
  // cover 2560px at the full stride but would fall short at the narrow one.
  it.each([1, 2, 3, 7, 8, 9, 12, 18])('still covers 2560px at the narrowest card width with %i unique items', (n) => {
    const track = buildMarqueeTrack(Array.from({ length: n }, (_, i) => i))
    expect((track.length / 2) * 288).toBeGreaterThanOrEqual(2560)
  })

  it('preserves order within each repeat', () => {
    expect(buildMarqueeTrack(['a', 'b']).slice(0, 4)).toEqual(['a', 'b', 'a', 'b'])
  })
})
