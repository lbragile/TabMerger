import { describe, it, expect, vi, afterEach } from 'vitest'
import { getChromeStoreStats } from '@/lib/chromeStoreStats'

describe('getChromeStoreStats', () => {
  const originalEnv = process.env.CHROME_WEBSTORE_EXTENSION_ID
  const originalFetch = global.fetch

  afterEach(() => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = originalEnv
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns null when no extension ID is configured', async () => {
    delete process.env.CHROME_WEBSTORE_EXTENSION_ID
    global.fetch = vi.fn()
    const result = await getChromeStoreStats()
    expect(result).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
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
    expect(result).toEqual({ rating: 4.5, ratingCount: 3600 })
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
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers['User-Agent']).toMatch(/Mozilla\/5\.0.*Chrome\//)
  })

  it('returns null for an unavailable listing (HTTP 200 "empty-title" shell)', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    const shell = '<html><head><title>Chrome Web Store</title></head><body><script>/* app shell */</script></body></html>'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => shell })
    expect(await getChromeStoreStats()).toBeNull()
  })
})
