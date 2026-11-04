/**
 * lib/rateLimit.ts: the shared, Postgres-backed request limiter, and lib/billingRequestGuard.ts's
 * billing bucket. The counting itself (fixed windows, reset, per-key and per-bucket isolation, a
 * refused hit counting nowhere, the advisory lock) runs in `public.rate_limit_take()` and is tested
 * against the real database in supabase/tests/025_rate_limits.test.sql. Here: what the helper sends,
 * how it reads the answer, and what a limiter failure means (fail open for billing, fail closed
 * when a bucket asks for it). Supabase is a stub RPC.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { mockRpc, mockCreateServiceRoleClient } = vi.hoisted(() => {
  const mockRpc = vi.fn()
  return { mockRpc, mockCreateServiceRoleClient: vi.fn(async () => ({ rpc: mockRpc })) }
})
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: mockCreateServiceRoleClient }))

import { rateLimitedResponse, takeRateLimit, type RateLimitBucket } from '@/lib/rateLimit'
import { BILLING_RATE_LIMIT, limitBillingRequest } from '@/lib/billingRequestGuard'

const OPEN: RateLimitBucket = { name: 'test_open', limits: [{ windowSeconds: 60, max: 3 }], onError: 'allow' }
const CLOSED: RateLimitBucket = { ...OPEN, name: 'test_closed', onError: 'deny' }

/**
 * A stand-in for rate_limit_take() with the same contract (fixed windows per bucket, key and
 * window; a refused hit counts nowhere), driven by a fake clock, so the helper's round trip can be
 * followed across a window boundary and between keys.
 */
function fakeLimiter(now: () => number) {
  const counters = new Map<string, { start: number; hits: number }>()
  return async (_fn: string, args: { p_bucket: string; p_key: string; p_windows: number[]; p_maxes: number[] }) => {
    const t = now()
    const slots = args.p_windows.map((w, i) => {
      const id = `${args.p_bucket}|${args.p_key}|${w}`
      const start = Math.floor(t / w) * w
      const row = counters.get(id)
      const hits = row && row.start === start ? row.hits : 0
      return { id, start, hits, max: args.p_maxes[i], end: start + w }
    })
    const full = slots.filter((s) => s.hits >= s.max)
    if (full.length) {
      return { data: [{ allowed: false, retry_after_seconds: Math.max(...full.map((s) => s.end - t)) }], error: null }
    }
    for (const s of slots) counters.set(s.id, { start: s.start, hits: s.hits + 1 })
    return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
  }
}

describe('takeRateLimit', () => {
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("sends the bucket's name and limits and the key to rate_limit_take", async () => {
    mockRpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })
    await takeRateLimit(BILLING_RATE_LIMIT, 'user-1')
    expect(mockRpc.mock.calls).toEqual([
      ['rate_limit_take', { p_bucket: 'billing', p_key: 'user-1', p_windows: [60, 3600], p_maxes: [10, 60] }],
    ])
  })

  it('uses the client it is given instead of creating one (the AI routes already have one)', async () => {
    const own = vi.fn().mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })
    await takeRateLimit(OPEN, 'ip:203.0.113.7', { rpc: own } as unknown as SupabaseClient)
    expect(own).toHaveBeenCalledTimes(1)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('allows up to the limit in a window, refuses with the wait to its end, and allows again in the next', async () => {
    let now = 999_980 // 20 s into a 60 s window (999_960 is a multiple of 60)
    mockRpc.mockImplementation(fakeLimiter(() => now))

    expect(await takeRateLimit(OPEN, 'user-1')).toEqual({ kind: 'allowed' })
    expect(await takeRateLimit(OPEN, 'user-1')).toEqual({ kind: 'allowed' })
    expect(await takeRateLimit(OPEN, 'user-1')).toEqual({ kind: 'allowed' })
    expect(await takeRateLimit(OPEN, 'user-1')).toEqual({ kind: 'limited', retryAfterSeconds: 40 })

    now += 40 // the next window
    expect(await takeRateLimit(OPEN, 'user-1')).toEqual({ kind: 'allowed' })
  })

  it('counts each key (user) on its own', async () => {
    mockRpc.mockImplementation(fakeLimiter(() => 1_000_000))
    for (let i = 0; i < 3; i++) await takeRateLimit(OPEN, 'user-1')
    expect((await takeRateLimit(OPEN, 'user-1')).kind).toBe('limited')
    expect(await takeRateLimit(OPEN, 'user-2')).toEqual({ kind: 'allowed' })
  })

  it('rounds a fractional or missing wait up to at least one second', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 0 }], error: null })
    expect(await takeRateLimit(OPEN, 'k')).toEqual({ kind: 'limited', retryAfterSeconds: 1 })
    mockRpc.mockResolvedValueOnce({ data: { allowed: false, retry_after_seconds: 2.2 }, error: null })
    expect(await takeRateLimit(OPEN, 'k')).toEqual({ kind: 'limited', retryAfterSeconds: 3 })
  })

  describe('when the limiter fails', () => {
    const failures: Array<[string, () => void, string]> = [
      [
        'the RPC answers an error',
        () => mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'not found' } }),
        'rate_limit_take failed (code PGRST202)',
      ],
      ['the RPC returns no row', () => mockRpc.mockResolvedValue({ data: [], error: null }), 'rate_limit_take returned no row'],
      ['the RPC throws (network)', () => mockRpc.mockRejectedValue(new TypeError('fetch failed')), 'rate_limit_take threw'],
    ]

    it.each(failures)('fails open for an allow bucket when %s, logging one line without the key', async (_why, arrange, logged) => {
      arrange()
      expect(await takeRateLimit(OPEN, 'user-secret-id')).toEqual({ kind: 'allowed' })
      expect(error.mock.calls).toEqual([[`Rate limit (test_open): ${logged}; allowing the request`]])
      expect(String(error.mock.calls[0][0])).not.toContain('user-secret-id')
    })

    it.each(failures)('fails closed for a deny bucket when %s', async (_why, arrange, logged) => {
      arrange()
      expect(await takeRateLimit(CLOSED, 'user-1')).toEqual({ kind: 'unavailable' })
      expect(error.mock.calls).toEqual([[`Rate limit (test_closed): ${logged}; refusing the request`]])
    })

    it('fails open when the service client cannot be created', async () => {
      mockCreateServiceRoleClient.mockRejectedValueOnce(new Error('no env'))
      expect(await takeRateLimit(OPEN, 'user-1')).toEqual({ kind: 'allowed' })
    })
  })
})

describe('rateLimitedResponse', () => {
  it('is a 429 rate_limited with Retry-After in whole seconds', async () => {
    const res = rateLimitedResponse(12.3)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('13')
    expect(await res.json()).toEqual({ error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 13 })
  })
})

describe('limitBillingRequest (the billing bucket)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is 10 a minute and 60 an hour per user, and fails open', () => {
    expect(BILLING_RATE_LIMIT).toEqual({
      name: 'billing',
      limits: [
        { windowSeconds: 60, max: 10 },
        { windowSeconds: 3600, max: 60 },
      ],
      onError: 'allow',
    })
  })

  it('returns null while under the limit and the 429 once over it', async () => {
    mockRpc.mockImplementation(fakeLimiter(() => 7_200_000))
    for (let i = 0; i < 10; i++) expect(await limitBillingRequest('user-1')).toBeNull()
    const res = await limitBillingRequest('user-1')
    expect(res?.status).toBe(429)
    expect(res?.headers.get('Retry-After')).toBe('60')
    // Another user is unaffected.
    expect(await limitBillingRequest('user-2')).toBeNull()
  })

  it('stops at 60 an hour even when each minute stays under 10', async () => {
    let now = 7_200_000
    mockRpc.mockImplementation(fakeLimiter(() => now))
    for (let minute = 0; minute < 6; minute++) {
      for (let i = 0; i < 10; i++) expect(await limitBillingRequest('user-1')).toBeNull()
      now += 60
    }
    const res = await limitBillingRequest('user-1')
    expect(res?.status).toBe(429)
    expect(res?.headers.get('Retry-After')).toBe(String(7_200_000 + 3600 - now))
  })

  it('lets the request through when the limiter is down (fail open)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } })
    expect(await limitBillingRequest('user-1')).toBeNull()
  })
})
