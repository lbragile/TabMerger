import { describe, it, expect, vi, afterEach } from 'vitest'
import { CHROME_EXTENSION_ID } from '@tabmerger/shared'
import {
  decodeHtmlEntities,
  getChromeStoreStats,
  parseChromeRating,
  parseChromeReviews,
  parseStoreDate,
} from '@/lib/chromeStoreStats'

const REVIEWS_URL = 'https://example.test/detail/abc123/reviews'

// Synthetic markup modelled on the store's reviews page: the same element structure, with
// made-up class names, names and text. Never paste a saved store page in here — it holds
// real people's names. The <svg><path> elements are deliberate: the page is full of them,
// and a body pattern written as `<p[^>]*>` matches `<path …>` first.
interface FakeReview {
  name: string
  score: number
  date: string
  body?: string
  /** Rendered cut short with a "Show more" button, as the store does past ~500 characters. */
  cut?: boolean
  reply?: string
}

const STAR = '<svg viewBox="0 0 24 24"><path d="M22 9.24l-7.19-.62L12 2z"/><path d="M0 0h24v24H0V0z" fill="none"/></svg>'

function reviewHtml({ name, score, date, body, cut = false, reply }: FakeReview): string {
  return (
    '<section class="aa1" jsaction="x:y"><img class="aa2" alt="Review&#39;s profile picture">' +
    `<div class="aa3"><h3 class="aa4" id="i4"><span class="aa5">${name}</span>` +
    `<div class="aa6" role="img" aria-label="${score} out of 5 stars" title="${score} out of 5 stars">${STAR}</div>` +
    `<span class="aa7">${date}</span></h3></div>` +
    `<div class="aa8"><button aria-label="Review options">${STAR}</button><ul role="menu"><li role="menuitem"><span>Report illegal content</span></li></ul></div>` +
    (body === undefined
      ? ''
      : `<p class="aa9"><span>${body}</span>${cut ? ' <span class="ab1" tabindex="0" role="button">Show more</span>' : ''}</p>`) +
    (reply === undefined
      ? ''
      : '<section class="ab2"><img alt="Replier&#39;s profile picture"><div role="heading" aria-level="4">' +
        `<span>Example Developer</span><span>Developer</span><span>${date}</span></div><p class="ab3">${reply}</p></section>`) +
    '</section>'
  )
}

/** The page's embedded data: nested arrays in a script, review texts as JSON strings. */
function embeddedData(texts: string[]): string {
  const rows = texts.map((text) => ['id', ['Name', 'https://example.test/a'], 5, text, [1634688000, 0]])
  return `<script nonce="n">AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify([rows])}, sideChannel: {}});</script>`
}

const page = (reviews: FakeReview[], embedded: string[] = []) =>
  `<html lang="en"><body><h2>Reviews</h2>${reviews.map(reviewHtml).join('')}${embeddedData(embedded)}</body></html>`

describe('parseChromeReviews', () => {
  it('reads the name, score, date and text of a review', () => {
    const [r] = parseChromeReviews(
      page([{ name: 'Sample Person', score: 5, date: 'Oct 20, 2021', body: 'Keeps every window tidy and is easy to use.' }]),
      REVIEWS_URL,
    )
    expect(r).toEqual({
      quote: 'Keeps every window tidy and is easy to use.',
      author: 'Sample Person',
      date: '2021-10-20T00:00:00.000Z',
      score: 5,
      url: REVIEWS_URL,
      store: 'chrome',
    })
  })

  it('decodes the entities the store escapes text with, leaving the words as written', () => {
    const [r] = parseChromeReviews(
      page([{ name: 'Sam &amp; Co', score: 5, date: 'Mar 1, 2021', body: 'It&#39;s &quot;great&quot; &amp; fast, 10 &gt; 9 for sure.' }]),
      REVIEWS_URL,
    )
    expect(r.quote).toBe('It\'s "great" & fast, 10 > 9 for sure.')
    expect(r.author).toBe('Sam & Co')
  })

  it('applies the shared rules: nothing under four stars, nothing trivially short, 5★ first then newest', () => {
    const picked = parseChromeReviews(
      page([
        { name: 'One', score: 4, date: 'Oct 1, 2021', body: 'Four stars and the newest of them all.' },
        { name: 'Two', score: 3, date: 'May 14, 2021', body: 'Three stars, so this is not a testimonial.' },
        { name: 'Three', score: 5, date: 'Feb 9, 2021', body: 'Five stars but the oldest of the lot.' },
        { name: 'Four', score: 5, date: 'Mar 8, 2021', body: 'Five stars and newer than the other.' },
        { name: 'Five', score: 5, date: 'Mar 9, 2021', body: 'Too short' },
      ]),
      REVIEWS_URL,
    )
    expect(picked.map((r) => r.author)).toEqual(['Four', 'Three', 'One'])
  })

  it('takes the complete text of a review the page cut short from the embedded data', () => {
    const full = `${'A long and detailed review. '.repeat(30)}The part after the cut.`
    const cutText = `${full.slice(0, 496)} ...`
    const [r] = parseChromeReviews(page([{ name: 'Long Writer', score: 5, date: 'Mar 7, 2021', body: cutText, cut: true }], [full]), REVIEWS_URL)
    expect(r.quote).toBe(full)
    expect(r.quote).not.toMatch(/\.\.\.$/)
  })

  it('drops a cut review whose complete text cannot be found, rather than showing the cut version', () => {
    const cutText = `${'Another long review that goes on. '.repeat(15)} ...`
    expect(parseChromeReviews(page([{ name: 'Long Writer', score: 5, date: 'Mar 7, 2021', body: cutText, cut: true }]), REVIEWS_URL)).toEqual([])
  })

  it('never takes the developer reply as the review text', () => {
    const html = page([
      { name: 'Rating Only', score: 5, date: 'Mar 7, 2021', reply: 'Thank you so much for the kind rating, it means a lot!' },
      { name: 'With Text', score: 5, date: 'Mar 6, 2021', body: 'Solid extension, does what it says.', reply: 'Thanks for the review!' },
    ])
    const picked = parseChromeReviews(html, REVIEWS_URL)
    expect(picked.map((r) => r.quote)).toEqual(['Solid extension, does what it says.'])
  })

  it('drops a review whose date cannot be read, rather than guessing one', () => {
    const picked = parseChromeReviews(
      page([
        { name: 'Relative', score: 5, date: '2 days ago', body: 'A perfectly good review with a relative date.' },
        { name: 'Other Language', score: 5, date: '20 oct 2021', body: 'A perfectly good review with a foreign date.' },
        { name: 'Impossible', score: 5, date: 'Feb 31, 2021', body: 'A perfectly good review with a bad date.' },
      ]),
      REVIEWS_URL,
    )
    expect(picked).toEqual([])
  })

  it('replaces the store placeholder name and returns nothing for a page with no reviews', () => {
    const [r] = parseChromeReviews(page([{ name: 'A Google user', score: 5, date: 'Mar 7, 2021', body: 'Simple, quick and reliable.' }]), REVIEWS_URL)
    expect(r.author).toBe('Anonymous reviewer')
    expect(parseChromeReviews('<html><body>app shell</body></html>', REVIEWS_URL)).toEqual([])
  })
})

describe('parseStoreDate', () => {
  it.each([
    ['Oct 20, 2021', '2021-10-20T00:00:00.000Z'],
    ['Feb 9, 2021', '2021-02-09T00:00:00.000Z'],
    ['Feb 29, 2024', '2024-02-29T00:00:00.000Z'],
    ['Dec 31, 2020', '2020-12-31T00:00:00.000Z'],
  ])('reads %j as midnight UTC of that day', (text, iso) => {
    expect(parseStoreDate(text)).toBe(iso)
  })

  it.each(['', 'yesterday', '2021-10-20', 'October 20, 2021', 'Foo 20, 2021', 'Feb 30, 2021', 'Oct 0, 2021'])(
    'returns null for %j',
    (text) => {
      expect(parseStoreDate(text)).toBeNull()
    },
  )
})

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities once, and leaves unknown ones alone', () => {
    expect(decodeHtmlEntities('&lt;b&gt; &#39;x&#x27; &amp;amp; &unknown; &#0;')).toBe("<b> 'x' &amp; &unknown; &#0;")
  })
})

describe('parseChromeRating', () => {
  it('prefers the unrounded mean from the embedded data when it agrees with what the page shows', () => {
    const html =
      '<div aria-label="4.6 out of 5 stars"></div><p>28 ratings</p>' +
      '<script>AF_initDataCallback({data:[["id","Name",4.571428571428571,28,"https://example.test/i"],["other","Else",4.6626371393742385,29532]]});</script>'
    expect(parseChromeRating(html)).toEqual({ rating: 4.571428571428571, ratingCount: 28 })
  })

  it('keeps the visible rating when no embedded value matches both the count and the rounding', () => {
    const html =
      '<div aria-label="4.6 out of 5 stars"></div><p>28 ratings</p>' +
      '<script>AF_initDataCallback({data:[["a",4.2,28],["b",4.571428571428571,29],["c",0.1000000014901161,2]]});</script>'
    expect(parseChromeRating(html)).toEqual({ rating: 4.6, ratingCount: 28 })
  })
})

describe('getChromeStoreStats', () => {
  const originalEnv = process.env.CHROME_WEBSTORE_EXTENSION_ID
  const originalFetch = global.fetch

  afterEach(() => {
    // Assigning undefined to process.env stores the string "undefined".
    if (originalEnv === undefined) delete process.env.CHROME_WEBSTORE_EXTENSION_ID
    else process.env.CHROME_WEBSTORE_EXTENSION_ID = originalEnv
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  /** Serves `listing` for the listing page and `reviews` for the reviews page (null = HTTP error). */
  function mockStore(listing: string | null, reviews: string | null = null) {
    const fetchMock = vi.fn((url: string) => {
      const html = new URL(url).pathname.endsWith('/reviews') ? reviews : listing
      return Promise.resolve(html === null ? { ok: false } : { ok: true, text: async () => html })
    })
    global.fetch = fetchMock as unknown as typeof fetch
    return fetchMock
  }

  it('reads the public stable listing by default and honours an override', async () => {
    delete process.env.CHROME_WEBSTORE_EXTENSION_ID
    let fetchMock = mockStore(null)
    await getChromeStoreStats()
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      `/detail/${CHROME_EXTENSION_ID.STABLE}`,
      `/detail/${CHROME_EXTENSION_ID.STABLE}/reviews`,
    ])

    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    fetchMock = mockStore(null)
    await getChromeStoreStats()
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/detail/abc123', '/detail/abc123/reviews'])
  })

  it('returns null when the fetch fails', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const result = await getChromeStoreStats()
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'))
    const result = await getChromeStoreStats()
    expect(result).toBeNull()
  })

  it('returns null when the page markup does not match the expected pattern', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>no stats here</html>' })
    const result = await getChromeStoreStats()
    expect(result).toBeNull()
  })

  // Excerpts copied from a real published listing (uBlock Origin Lite), not written
  // by hand. The fixture this replaced — `aria-label="4.8 out of 5 stars. 2,400
  // ratings."` — was invented, matched nothing the store actually serves, and let
  // this function pass its tests for its whole life while never once returning a
  // number in production.
  const REAL_LISTING =
    '<span class="GlMWqe">4.5 out of 5<div class="B1UG8d or8rae" role="img" aria-label="4.5 out of 5 stars" title="4.5 out of 5 stars"></div></span>' +
    '<p class="xJEoWe">3.6K ratings</p>' +
    // A recommended item further down the same page — must not be picked up.
    '<span class="GvZmud" role="img" aria-label="Average rating 4.1 out of 5 stars." id="i16"><span class="Vq0ZA">4.1</span></span>'

  it('parses the headline rating and abbreviated count from real listing markup', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => REAL_LISTING })
    const result = await getChromeStoreStats()
    expect(result).toEqual({ rating: 4.5, ratingCount: 3600, reviews: [] })
  })

  it('returns the reviews parsed from the reviews page, linked to that page', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    mockStore(REAL_LISTING, page([{ name: 'Sample Person', score: 5, date: 'Oct 20, 2021', body: 'Keeps every window tidy and is easy to use.' }]))
    const result = await getChromeStoreStats()
    expect(result?.rating).toBe(4.5)
    expect(result?.reviews).toHaveLength(1)
    expect(result?.reviews[0].url).toBe('https://chromewebstore.google.com/detail/abc123/reviews')
    expect(result?.reviews[0].store).toBe('chrome')
  })

  it('still returns the rating when the reviews page cannot be fetched or read', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    mockStore(REAL_LISTING, null)
    expect(await getChromeStoreStats()).toEqual({ rating: 4.5, ratingCount: 3600, reviews: [] })

    mockStore(REAL_LISTING, '<html><body>markup the parser has never seen</body></html>')
    expect(await getChromeStoreStats()).toEqual({ rating: 4.5, ratingCount: 3600, reviews: [] })

    // The reviews request itself throwing must not take the rating down with it.
    global.fetch = vi.fn((url: string) =>
      new URL(url).pathname.endsWith('/reviews')
        ? Promise.reject(new Error('network error'))
        : Promise.resolve({ ok: true, text: async () => REAL_LISTING }),
    ) as unknown as typeof fetch
    expect(await getChromeStoreStats()).toEqual({ rating: 4.5, ratingCount: 3600, reviews: [] })
  })

  it('ignores recommended items\' "Average rating" labels', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    const html = '<p>12 ratings</p><span aria-label="Average rating 4.1 out of 5 stars."></span>'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })
    expect(await getChromeStoreStats()).toBeNull()
  })

  it.each([
    ['47 ratings', 47],
    ['1,204 ratings', 1204],
    ['3.6K ratings', 3600],
    ['1.2M ratings', 1_200_000],
    ['1 rating', 1],
  ])('expands the store\'s abbreviated count "%s"', async (text, expected) => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    const html = `<div aria-label="4.5 out of 5 stars"></div><p>${text}</p>`
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })
    expect((await getChromeStoreStats())?.ratingCount).toBe(expected)
  })

  it('sends a browser User-Agent — without one the store serves a data-less shell', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => REAL_LISTING })
    global.fetch = fetchMock
    await getChromeStoreStats()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls as [string, { headers: Record<string, string> }][]) {
      expect(init.headers['User-Agent']).toMatch(/Mozilla\/5\.0.*Chrome\//)
    }
  })

  it('returns null for an unavailable listing (HTTP 200 "empty-title" shell)', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    const shell = '<html><head><title>Chrome Web Store</title></head><body><script>/* app shell */</script></body></html>'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => shell })
    expect(await getChromeStoreStats()).toBeNull()
  })
})
