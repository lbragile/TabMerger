import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { devReviewsDelayMs, getStoreRatings } from '@/lib/storeRatings'
import { getChromeStoreStats } from '@/lib/chromeStoreStats'
import { getEdgeAddonStats } from '@/lib/edgeAddonStats'
import { getFirefoxAddonStats } from '@/lib/firefoxAddonStats'

vi.mock('@/lib/chromeStoreStats', () => ({ getChromeStoreStats: vi.fn() }))
vi.mock('@/lib/firefoxAddonStats', () => ({ getFirefoxAddonStats: vi.fn() }))
vi.mock('@/lib/edgeAddonStats', () => ({ getEdgeAddonStats: vi.fn() }))

// The delay exists so the loading placeholder can be looked at on a development server.
describe('devReviewsDelayMs', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is the configured delay on a development server', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REVIEWS_DELAY_MS', '5000')
    expect(devReviewsDelayMs()).toBe(5000)
  })

  it.each(['production', 'test'])('is ignored when NODE_ENV is %s', (nodeEnv) => {
    vi.stubEnv('NODE_ENV', nodeEnv)
    vi.stubEnv('REVIEWS_DELAY_MS', '5000')
    expect(devReviewsDelayMs()).toBe(0)
  })

  it('is 0 when the variable is not set', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REVIEWS_DELAY_MS', '')
    expect(devReviewsDelayMs()).toBe(0)
  })

  it.each(['0', '-5', '1.5', '5s', ' 500', '1e3', 'true'])('ignores %j: only a positive whole number counts', (value) => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REVIEWS_DELAY_MS', value)
    expect(devReviewsDelayMs()).toBe(0)
  })

  it('is capped at 30 seconds', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REVIEWS_DELAY_MS', '999999999')
    expect(devReviewsDelayMs()).toBe(30_000)
  })
})

describe('getStoreRatings and the development delay', () => {
  const stats = { rating: 4.5, ratingCount: 10, reviews: [] }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getChromeStoreStats).mockResolvedValue(stats)
    vi.mocked(getFirefoxAddonStats).mockResolvedValue(null)
    vi.mocked(getEdgeAddonStats).mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  /** Whether the promise has settled once everything already queued has run. */
  async function settledNow(promise: Promise<unknown>): Promise<boolean> {
    let settled = false
    void promise.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    return settled
  }

  it('resolves without waiting in production, whatever REVIEWS_DELAY_MS says', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('REVIEWS_DELAY_MS', '5000')
    const ratings = getStoreRatings()
    expect(await settledNow(ratings)).toBe(true)
    expect(vi.getTimerCount()).toBe(0) // no timer was even started
    expect((await ratings)?.ratingCount).toBe(10)
  })

  it('holds the result back for the configured time on a development server', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REVIEWS_DELAY_MS', '5000')
    const ratings = getStoreRatings()
    expect(await settledNow(ratings)).toBe(false)

    await vi.advanceTimersByTimeAsync(4999)
    expect(await settledNow(ratings)).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(await settledNow(ratings)).toBe(true)
    expect((await ratings)?.ratingCount).toBe(10)
  })

  it('does not wait on a development server without the variable', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('REVIEWS_DELAY_MS', '')
    expect(await settledNow(getStoreRatings())).toBe(true)
  })
})
