import { describe, it, expect, vi, beforeEach } from 'vitest'
import { combineRatings, formatRating, getStoreRatings, interleaveReviews } from '@/lib/storeRatings'
import { getChromeStoreStats } from '@/lib/chromeStoreStats'
import { getEdgeAddonStats } from '@/lib/edgeAddonStats'
import { getFirefoxAddonStats } from '@/lib/firefoxAddonStats'
import type { StoreReview } from '@/lib/storeReviews'

vi.mock('@/lib/chromeStoreStats', () => ({ getChromeStoreStats: vi.fn() }))
vi.mock('@/lib/firefoxAddonStats', () => ({ getFirefoxAddonStats: vi.fn() }))
vi.mock('@/lib/edgeAddonStats', () => ({ getEdgeAddonStats: vi.fn() }))

describe('combineRatings', () => {
  it('is 0 / 0 for no stores', () => {
    expect(combineRatings([])).toEqual({ rating: 0, ratingCount: 0 })
  })

  it('returns a single store unchanged', () => {
    expect(combineRatings([{ rating: 4.6, ratingCount: 120 }])).toEqual({ rating: 4.6, ratingCount: 120 })
  })

  it('weights by rating count, not a plain average of averages', () => {
    const { rating, ratingCount } = combineRatings([
      { rating: 5, ratingCount: 1 },
      { rating: 3, ratingCount: 99 },
    ])
    expect(ratingCount).toBe(100)
    expect(rating).toBeCloseTo(3.02, 10)
  })

  it('sums three stores and equals the mean of every rating given', () => {
    const { rating, ratingCount } = combineRatings([
      { rating: 4.5, ratingCount: 10 },
      { rating: 5, ratingCount: 4 },
      { rating: 4, ratingCount: 6 },
    ])
    expect(ratingCount).toBe(20)
    expect(rating).toBeCloseTo((45 + 20 + 24) / 20, 10)
  })

  it('uses unrounded inputs: it is not built from two-decimal values', () => {
    const { rating } = combineRatings([
      { rating: 4.004, ratingCount: 1 },
      { rating: 4.004, ratingCount: 1 },
    ])
    expect(rating).toBeCloseTo(4.004, 10)
    expect(rating).not.toBe(4)
  })

  it('ignores a store whose count is 0', () => {
    expect(
      combineRatings([
        { rating: 5, ratingCount: 0 },
        { rating: 4, ratingCount: 10 },
      ]),
    ).toEqual({ rating: 4, ratingCount: 10 })
  })

  it('is 0 / 0 when every count is 0', () => {
    expect(
      combineRatings([
        { rating: 5, ratingCount: 0 },
        { rating: 4, ratingCount: 0 },
      ]),
    ).toEqual({ rating: 0, ratingCount: 0 })
  })
})

describe('formatRating', () => {
  it.each([
    [4.57, '4.57'],
    [3, '3.00'],
    [5, '5.00'],
    [0, '0.00'],
    [4.5, '4.50'],
    [4.574, '4.57'],
    [4.576, '4.58'],
    [4.999, '5.00'],
    [4.994, '4.99'],
    [4.125, '4.13'],
    [4.875, '4.88'],
  ])('formats %s as %s', (input, expected) => {
    expect(formatRating(input)).toBe(expected)
  })

  it('always has exactly two decimals', () => {
    for (const r of [1, 2.1, 3.14159, 4.9999, 4.005]) expect(formatRating(r)).toMatch(/^\d\.\d{2}$/)
  })
})

function review(store: StoreReview['store'], n: number): StoreReview {
  return {
    quote: `${store}-${n}`,
    author: 'A',
    date: '2026-01-01T00:00:00.000Z',
    score: 5,
    url: `https://example.com/${store}/${n}`,
    store,
  }
}
const ids = (rs: { quote: string }[]) => rs.map((r) => r.quote)

describe('interleaveReviews', () => {
  it('returns [] for no lists and for only empty lists', () => {
    expect(interleaveReviews([])).toEqual([])
    expect(interleaveReviews([[], [], []])).toEqual([])
  })

  it('keeps a single list in its own order', () => {
    const a = [review('chrome', 1), review('chrome', 2), review('chrome', 3)]
    expect(interleaveReviews([a])).toEqual(a)
  })

  it('alternates equal-length lists strictly, the first list leading', () => {
    const out = interleaveReviews([
      [review('chrome', 1), review('chrome', 2)],
      [review('firefox', 1), review('firefox', 2)],
      [review('edge', 1), review('edge', 2)],
    ])
    expect(ids(out)).toEqual(['chrome-1', 'firefox-1', 'edge-1', 'chrome-2', 'firefox-2', 'edge-2'])
  })

  it('spreads a short list through a long one instead of using it up first', () => {
    const long = [1, 2, 3, 4, 5, 6].map((n) => review('chrome', n))
    const short = [review('edge', 1), review('edge', 2)]
    const out = ids(interleaveReviews([long, short]))
    expect(out).toHaveLength(8)
    expect(out.indexOf('edge-1')).toBeGreaterThan(0)
    expect(out.indexOf('edge-2') - out.indexOf('edge-1')).toBeGreaterThanOrEqual(3)
    expect(out.indexOf('edge-2')).toBeLessThan(out.length - 1)
  })

  it("preserves each list's internal order and loses nothing", () => {
    const a = [1, 2, 3, 4].map((n) => review('chrome', n))
    const b = [1, 2, 3].map((n) => review('firefox', n))
    const out = ids(interleaveReviews([a, b]))
    expect(out.filter((q) => q.startsWith('chrome'))).toEqual(ids(a))
    expect(out.filter((q) => q.startsWith('firefox'))).toEqual(ids(b))
    expect(out).toHaveLength(7)
  })

  it('skips an empty list among non-empty ones', () => {
    expect(ids(interleaveReviews([[review('chrome', 1)], [], [review('edge', 1)]]))).toEqual(['chrome-1', 'edge-1'])
  })

  it('breaks ties in favour of the list given first', () => {
    expect(ids(interleaveReviews([[review('edge', 1)], [review('chrome', 1)]]))).toEqual(['edge-1', 'chrome-1'])
  })
})

describe('getStoreRatings aggregation', () => {
  beforeEach(() => {
    vi.mocked(getChromeStoreStats).mockReset()
    vi.mocked(getFirefoxAddonStats).mockReset()
    vi.mocked(getEdgeAddonStats).mockReset()
  })

  it('is null when no store returns data', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue(null)
    vi.mocked(getFirefoxAddonStats).mockResolvedValue(null)
    vi.mocked(getEdgeAddonStats).mockResolvedValue(null)
    expect(await getStoreRatings()).toBeNull()
  })

  it('is null when every store rejects', async () => {
    vi.mocked(getChromeStoreStats).mockRejectedValue(new Error('x'))
    vi.mocked(getFirefoxAddonStats).mockRejectedValue(new Error('x'))
    vi.mocked(getEdgeAddonStats).mockRejectedValue(new Error('x'))
    expect(await getStoreRatings()).toBeNull()
  })

  it('treats a source that throws synchronously as a failed store, keeping the others', async () => {
    vi.mocked(getChromeStoreStats).mockImplementation(() => {
      throw new Error('sync boom')
    })
    vi.mocked(getFirefoxAddonStats).mockResolvedValue({ rating: 4, ratingCount: 2, reviews: [] })
    vi.mocked(getEdgeAddonStats).mockResolvedValue(null)
    const r = await getStoreRatings()
    expect(r?.stores.map((s) => s.store)).toEqual(['firefox'])
    expect(r?.rating).toBe(4)
  })

  it('keeps stores in chrome, firefox, edge order, tagging each with its id', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue({ rating: 5, ratingCount: 1, reviews: [] })
    vi.mocked(getFirefoxAddonStats).mockRejectedValue(new Error('down'))
    vi.mocked(getEdgeAddonStats).mockResolvedValue({ rating: 3, ratingCount: 3, reviews: [] })
    const r = await getStoreRatings()
    expect(r?.stores.map((s) => s.store)).toEqual(['chrome', 'edge'])
    expect(r?.ratingCount).toBe(4)
    expect(r?.rating).toBeCloseTo(3.5, 10)
  })

  it('counts a store with ratings but no reviews, and interleaves the rest', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue({
      rating: 4.8,
      ratingCount: 10,
      reviews: [review('chrome', 1), review('chrome', 2)],
    })
    vi.mocked(getFirefoxAddonStats).mockResolvedValue({ rating: 4, ratingCount: 10, reviews: [] })
    vi.mocked(getEdgeAddonStats).mockResolvedValue({ rating: 5, ratingCount: 5, reviews: [review('edge', 1)] })
    const r = await getStoreRatings()
    expect(r?.stores).toHaveLength(3)
    expect(r?.ratingCount).toBe(25)
    expect(ids(r!.reviews)).toEqual(['chrome-1', 'edge-1', 'chrome-2'])
  })

  it('tolerates a store that omits the reviews field', async () => {
    vi.mocked(getChromeStoreStats).mockResolvedValue({ rating: 4, ratingCount: 1 } as never)
    vi.mocked(getFirefoxAddonStats).mockResolvedValue(null)
    vi.mocked(getEdgeAddonStats).mockResolvedValue(null)
    expect((await getStoreRatings())?.reviews).toEqual([])
  })

  it('starts all three sources before any has finished (concurrent)', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    vi.mocked(getChromeStoreStats).mockImplementation(async () => {
      order.push('chrome-start')
      await gate
      return { rating: 4, ratingCount: 1, reviews: [] }
    })
    vi.mocked(getFirefoxAddonStats).mockImplementation(async () => {
      order.push('firefox-start')
      return null
    })
    vi.mocked(getEdgeAddonStats).mockImplementation(async () => {
      order.push('edge-start')
      return null
    })
    const p = getStoreRatings()
    await Promise.resolve()
    expect(order).toEqual(['chrome-start', 'firefox-start', 'edge-start'])
    release()
    expect((await p)?.stores).toHaveLength(1)
  })
})
