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

  it('parses rating and rating count from the listing page markup', async () => {
    process.env.CHROME_WEBSTORE_EXTENSION_ID = 'abc123'
    const html = '<div aria-label="4.8 out of 5 stars. 2,400 ratings."></div>'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html })
    const result = await getChromeStoreStats()
    expect(result).toEqual({ rating: 4.8, ratingCount: 2400 })
  })
})
