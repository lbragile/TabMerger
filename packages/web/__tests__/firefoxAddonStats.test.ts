import { describe, it, expect, vi, afterEach } from 'vitest'
import { getFirefoxAddonStats, selectReviews } from '@/lib/firefoxAddonStats'
import { MIN_UNIQUE_REVIEWS } from '@/components/marketing/ReviewsStrip'
import realRatings from './fixtures/amo-ratings.tabmerger.json'

const review = (over: Partial<{ score: number; body: string | null; created: string; name: string | undefined }> = {}) => ({
  score: over.score ?? 5,
  body: over.body === undefined ? 'Works better and cleaner than OneTab' : over.body,
  created: over.created ?? '2020-12-01T00:00:00Z',
  user: { name: 'name' in over ? over.name : 'Namsakhi' },
})

function mockAmo(addon: unknown, ratings: unknown, { addonOk = true, ratingsOk = true } = {}) {
  global.fetch = vi.fn((url: string) =>
    Promise.resolve(
      url.includes('/ratings/')
        ? { ok: ratingsOk, json: async () => ratings }
        : { ok: addonOk, json: async () => addon },
    ),
  ) as unknown as typeof fetch
}

describe('selectReviews', () => {
  it('keeps a review verbatim, trimming only surrounding whitespace', () => {
    const body = 'Found TabMerger really helpful in organizing several tabs, saving my time and memory.'
    const [r] = selectReviews([review({ body: `  ${body}\n` })])
    expect(r.quote).toBe(body)
    expect(r.score).toBe(5)
  })

  it('includes 4★ reviews — they are shown in full with their real score', () => {
    const mixed = 'I came from OneTab, and at first really really liked this. But every once in a while, it deletes all my tabs'
    const [r] = selectReviews([review({ score: 4, body: mixed })])
    expect(r.score).toBe(4)
    // Kept whole, criticism included — the card scrolls rather than truncating.
    expect(r.quote).toBe(mixed)
  })

  it('excludes anything below four stars', () => {
    expect(selectReviews([review({ score: 3 }), review({ score: 1 })])).toEqual([])
  })

  it('keeps long reviews intact instead of dropping or truncating them', () => {
    const long = 'Great extension. '.repeat(200).trim()
    expect(selectReviews([review({ body: long })])[0].quote).toBe(long)
  })

  it('excludes trivially short or empty reviews', () => {
    expect(selectReviews([review({ body: 'good' }), review({ body: null }), review({ body: '   ' })])).toEqual([])
  })

  it('keeps reviews containing profanity, verbatim and uncensored', () => {
    const body = 'Your plugin is fucking AWESOME, thanks a lot'
    expect(selectReviews([review({ body })])[0].quote).toBe(body)
  })

  it('orders five-star reviews first, then newest', () => {
    const picked = selectReviews([
      review({ score: 4, created: '2021-06-01T00:00:00Z', body: 'Four star but newest review' }),
      review({ score: 5, created: '2020-01-01T00:00:00Z', body: 'Five star but oldest review' }),
      review({ score: 5, created: '2021-01-01T00:00:00Z', body: 'Five star and newer review' }),
    ])
    expect(picked.map((r) => r.quote)).toEqual([
      'Five star and newer review',
      'Five star but oldest review',
      'Four star but newest review',
    ])
  })

  it.each([
    ['Firefox user 13445065', 'Anonymous reviewer'],
    ['Firefox user', 'Anonymous reviewer'],
    [undefined, 'Anonymous reviewer'],
    ['  ', 'Anonymous reviewer'],
    ['Namsakhi', 'Namsakhi'],
  ])('maps AMO placeholder author %j to %j and keeps real names', (name, expected) => {
    expect(selectReviews([review({ name })])[0].author).toBe(expected)
  })

  it('links each review to its own page on the store, or the reviews list without an id', () => {
    const [withId] = selectReviews([{ ...review(), id: 1644233 }])
    expect(withId.url).toBe('https://addons.mozilla.org/firefox/addon/tabmerger/reviews/1644233/')
    const [noId] = selectReviews([review()])
    expect(noId.url).toBe('https://addons.mozilla.org/firefox/addon/tabmerger/reviews/')
  })

  describe('against the real TabMerger listing (fixture captured from the AMO API)', () => {
    const picked = selectReviews(realRatings.results)

    it(`yields at least ${MIN_UNIQUE_REVIEWS} unique reviews — enough to fill a screen without repeats`, () => {
      expect(new Set(picked.map((r) => r.quote)).size).toBeGreaterThanOrEqual(MIN_UNIQUE_REVIEWS)
    })

    it('never names Firefox in an attribution', () => {
      for (const r of picked) expect(r.author).not.toMatch(/firefox/i)
    })

    it('contains nothing below four stars', () => {
      for (const r of picked) expect(r.score).toBeGreaterThanOrEqual(4)
    })
  })
})

describe('getFirefoxAddonStats', () => {
  const originalFetch = global.fetch
  const originalSlug = process.env.FIREFOX_ADDON_SLUG

  afterEach(() => {
    global.fetch = originalFetch
    process.env.FIREFOX_ADDON_SLUG = originalSlug
    vi.restoreAllMocks()
  })

  it('reads headline stats from the AMO API and rounds to one decimal', async () => {
    mockAmo({ ratings: { average: 3.9333, count: 15 } }, { results: [review()] })
    const stats = await getFirefoxAddonStats()
    expect(stats?.rating).toBe(3.9)
    expect(stats?.ratingCount).toBe(15)
    expect(stats?.reviews).toHaveLength(1)
  })

  it('queries the public listing slug by default and honours an override', async () => {
    delete process.env.FIREFOX_ADDON_SLUG
    mockAmo({ ratings: { average: 4, count: 3 } }, { results: [] })
    await getFirefoxAddonStats()
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('/addons/addon/tabmerger/')

    process.env.FIREFOX_ADDON_SLUG = 'other-slug'
    mockAmo({ ratings: { average: 4, count: 3 } }, { results: [] })
    await getFirefoxAddonStats()
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain('/addons/addon/other-slug/')
  })

  it('still returns headline stats when only the reviews call fails', async () => {
    mockAmo({ ratings: { average: 4.2, count: 9 } }, null, { ratingsOk: false })
    expect(await getFirefoxAddonStats()).toEqual({ rating: 4.2, ratingCount: 9, reviews: [] })
  })

  it('returns null when the add-on lookup fails', async () => {
    mockAmo(null, { results: [] }, { addonOk: false })
    expect(await getFirefoxAddonStats()).toBeNull()
  })

  it('returns null when there are no ratings — never shows 0 / 5', async () => {
    mockAmo({ ratings: { average: 0, count: 0 } }, { results: [] })
    expect(await getFirefoxAddonStats()).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch
    expect(await getFirefoxAddonStats()).toBeNull()
  })
})
