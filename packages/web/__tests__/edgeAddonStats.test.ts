import { describe, it, expect, vi, afterEach } from 'vitest'
import { EDGE_PRODUCT_DETAILS_URL, EDGE_REVIEWS_API_URL, STORE_LISTING_URL } from '@tabmerger/shared'
import { getEdgeAddonStats, selectEdgeReviews } from '@/lib/edgeAddonStats'

// Synthetic items with invented names and text, and ONLY the fields the module reads. The
// real response carries more per review (account and device identifiers): never copy a
// captured response in here.
const item = (over: Record<string, unknown> = {}) => ({
  Rating: 5,
  ReviewText: 'Groups my tabs neatly and restores them fast.',
  UserName: 'Sample Person',
  SubmittedDateTime: '2021-02-25T06:08:45.4391767Z',
  IsTakenDown: false,
  IsPublished: true,
  ...over,
})

const PRODUCT_ID = 'TESTPRODUCT1'
const details = { averageRating: 3, ratingCount: 4, storeProductId: PRODUCT_ID }

/** Serves `product` for the details call and `reviews` for the reviews call (null = HTTP error). */
function mockEdge(product: unknown, reviews: unknown = { Items: [] }) {
  const fetchMock = vi.fn((url: string) => {
    const body = url.startsWith(EDGE_REVIEWS_API_URL) ? reviews : product
    return Promise.resolve(body === null ? { ok: false } : { ok: true, json: async () => body })
  })
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('selectEdgeReviews', () => {
  it('maps a review to the shared shape, linked to the Edge listing', () => {
    expect(selectEdgeReviews([item()])).toEqual([
      {
        quote: 'Groups my tabs neatly and restores them fast.',
        author: 'Sample Person',
        date: '2021-02-25T06:08:45.439Z',
        score: 5,
        url: STORE_LISTING_URL.EDGE_STABLE,
        store: 'edge',
      },
    ])
  })

  it('applies the shared rules: 4★ and up, not trivially short, 5★ first then newest', () => {
    const picked = selectEdgeReviews([
      item({ Rating: 1, UserName: 'One', ReviewText: 'One star, so not a testimonial at all.' }),
      item({ Rating: 4, UserName: 'Two', SubmittedDateTime: '2022-04-28T07:05:05.8448708Z' }),
      item({ Rating: 5, UserName: 'Three', SubmittedDateTime: '2021-02-25T06:08:45.4391767Z' }),
      item({ Rating: 5, UserName: 'Four', ReviewText: 'Too short' }),
      item({ Rating: 5, UserName: 'Five', SubmittedDateTime: '2021-06-01T00:00:00Z' }),
    ])
    expect(picked.map((r) => r.author)).toEqual(['Five', 'Three', 'Two'])
  })

  it('skips reviews the store has taken down or not published', () => {
    expect(selectEdgeReviews([item({ IsTakenDown: true }), item({ IsPublished: false })])).toEqual([])
  })

  it('drops a review whose date cannot be read, rather than guessing one', () => {
    expect(
      selectEdgeReviews([
        item({ SubmittedDateTime: undefined }),
        item({ SubmittedDateTime: 'last week' }),
        // No offset: it would be read in the server's timezone.
        item({ SubmittedDateTime: '2021-02-25T06:08:45' }),
      ]),
    ).toEqual([])
  })

  it('uses the anonymous label for a missing name and censors profanity like every store', () => {
    const [anonymous] = selectEdgeReviews([item({ UserName: undefined })])
    expect(anonymous.author).toBe('Anonymous reviewer')
    const [censored] = selectEdgeReviews([item({ ReviewText: 'Your plugin is fucking AWESOME, thanks a lot' })])
    expect(censored.quote).toBe('Your plugin is f***ing AWESOME, thanks a lot')
  })

  it('returns nothing for a response that is not a list of reviews', () => {
    expect(selectEdgeReviews(undefined)).toEqual([])
    expect(selectEdgeReviews({ Items: [] })).toEqual([])
    expect(selectEdgeReviews([null, 'text', 3, { Rating: '5' }])).toEqual([])
  })
})

describe('getEdgeAddonStats', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('reads the rating from the product details and the reviews by the product ID it returns', async () => {
    const fetchMock = mockEdge(details, { PagingInfo: { TotalItems: 1 }, Items: [item()] })
    const stats = await getEdgeAddonStats()
    expect(stats?.rating).toBe(3)
    expect(stats?.ratingCount).toBe(4)
    expect(stats?.reviews).toHaveLength(1)
    expect(fetchMock.mock.calls[0][0]).toBe(EDGE_PRODUCT_DETAILS_URL)
    expect(fetchMock.mock.calls[1][0]).toMatch(new RegExp(`^${EDGE_REVIEWS_API_URL}/${PRODUCT_ID}\\?`))
  })

  it('keeps the rating when the reviews call fails, throws or is unreadable', async () => {
    mockEdge(details, null)
    expect(await getEdgeAddonStats()).toEqual({ rating: 3, ratingCount: 4, reviews: [] })

    mockEdge(details, { unexpected: true })
    expect(await getEdgeAddonStats()).toEqual({ rating: 3, ratingCount: 4, reviews: [] })

    global.fetch = vi.fn((url: string) =>
      url.startsWith(EDGE_REVIEWS_API_URL)
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({ ok: true, json: async () => details }),
    ) as unknown as typeof fetch
    expect(await getEdgeAddonStats()).toEqual({ rating: 3, ratingCount: 4, reviews: [] })
  })

  it('does not call the reviews endpoint without a plain product ID', async () => {
    for (const storeProductId of [undefined, 42, '', '../other', 'a b']) {
      const fetchMock = mockEdge({ ...details, storeProductId })
      expect(await getEdgeAddonStats()).toEqual({ rating: 3, ratingCount: 4, reviews: [] })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it('returns null when the details call fails, throws or has no usable rating', async () => {
    mockEdge(null)
    expect(await getEdgeAddonStats()).toBeNull()

    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch
    expect(await getEdgeAddonStats()).toBeNull()

    for (const product of [{}, null, { averageRating: 0, ratingCount: 0 }, { averageRating: '3', ratingCount: 4 }, { averageRating: 7, ratingCount: 4 }]) {
      mockEdge(product)
      expect(await getEdgeAddonStats()).toBeNull()
    }
  })
})
