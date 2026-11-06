/**
 * Per-IP limits on the two unauthenticated extension routes (lib/publicRateLimits.ts):
 * `/api/track` (in memory only) and `/api/og-preview` (in memory, then the shared Postgres limiter
 * from an address's 10th call in a minute). Covers under/over the limits, no trusted address,
 * failing open, IPv6 /64 sharing, and what each route answers when limited (status, body,
 * headers, and that nothing downstream runs).
 *
 * The limiters are module-level, so every test uses its own client address. The clock is frozen
 * mid-minute so a run can't cross a window boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  memoryThrows: false,
  rpc: vi.fn(),
  lookup: vi.fn(),
}))

// Wraps the real limiter so a test can make it throw.
vi.mock('@/lib/memoryRateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/memoryRateLimit')>()
  return {
    ...actual,
    createMemoryRateLimiter: (...args: Parameters<typeof actual.createMemoryRateLimiter>) => {
      const real = actual.createMemoryRateLimiter(...args)
      return {
        take: (key: string, now?: number) => {
          if (h.memoryThrows) throw new Error('boom')
          return real.take(key, now)
        },
        size: real.size,
      }
    },
  }
})
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: vi.fn(async () => ({ rpc: h.rpc })) }))
// og-preview must not reach DNS or the network in these tests.
vi.mock('node:dns/promises', () => ({ lookup: h.lookup, default: { lookup: h.lookup } }))

import {
  limitOgPreviewByIp,
  limitTrackByIp,
  OG_PREVIEW_IP_LIMITS,
  OG_PREVIEW_IP_RATE_LIMIT,
  OG_PREVIEW_SHARED_CHECK_FROM,
  publicRouteIpKey,
  TRACK_IP_LIMITS,
} from '@/lib/publicRateLimits'
import { hashIpKey } from '@/lib/clientIp'
import { POST as trackPost } from '@/app/api/track/route'
import { POST as ogPreviewPost } from '@/app/api/og-preview/route'

/** 10:00:30 UTC: half a minute before the next minute window. */
const NOW = Date.UTC(2026, 10, 5, 10, 0, 30)
const TRACK_PER_MINUTE = TRACK_IP_LIMITS[0].max
const OG_PER_MINUTE = OG_PREVIEW_IP_LIMITS[0].max

let ipCounter = 0
/** A fresh documentation-range IPv4 address per call. */
function freshIp(): string {
  ipCounter += 1
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`
}

/** Request headers as Vercel sets them for a client at `ip`. */
function vercelHeaders(ip: string): Headers {
  return new Headers({ 'x-vercel-forwarded-for': ip })
}

const allowedRpc = () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  h.memoryThrows = false
  h.rpc.mockReset().mockImplementation(async () => allowedRpc())
  h.lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-secret')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('publicRouteIpKey', () => {
  it('reads only the platform header and normalises the address', () => {
    expect(publicRouteIpKey(vercelHeaders('203.0.113.9'), 'vercel')).toBe('4:203.0.113.9')
    expect(publicRouteIpKey(new Headers({ 'cf-connecting-ip': '203.0.113.9' }), 'vercel')).toBeNull()
    expect(publicRouteIpKey(new Headers({ 'cf-connecting-ip': '2001:db8:1:2::5' }), 'cloudflare')).toBe('6:2001:db8:1:2::/64')
  })

  it('is null off a known platform, whatever the headers say', () => {
    expect(publicRouteIpKey(vercelHeaders('203.0.113.9'), null)).toBeNull()
  })

  it('is null for a header that is not an address', () => {
    expect(publicRouteIpKey(vercelHeaders('not-an-ip'), 'vercel')).toBeNull()
  })
})

describe('limitTrackByIp', () => {
  it('allows up to the per-minute limit, then refuses until the next minute', () => {
    const headers = vercelHeaders(freshIp())
    for (let i = 0; i < TRACK_PER_MINUTE; i++) expect(limitTrackByIp(headers, 'vercel')).toEqual({ limited: false })
    expect(limitTrackByIp(headers, 'vercel')).toEqual({ limited: true, retryAfterSeconds: 30 })
    vi.setSystemTime(NOW + 30_000)
    expect(limitTrackByIp(headers, 'vercel')).toEqual({ limited: false })
  })

  it('applies the hourly limit too', () => {
    const headers = vercelHeaders(freshIp())
    const [perMinute, perHour] = TRACK_IP_LIMITS
    let allowed = 0
    for (let minute = 0; minute < 60 && allowed < perHour.max + 1; minute++) {
      vi.setSystemTime(Date.UTC(2026, 10, 5, 10, minute, 1))
      for (let i = 0; i < perMinute.max; i++) if (!limitTrackByIp(headers, 'vercel').limited) allowed += 1
    }
    expect(allowed).toBe(perHour.max)
  })

  it('never limits a request without a trusted address', () => {
    const headers = vercelHeaders(freshIp())
    for (let i = 0; i < TRACK_PER_MINUTE + 5; i++) expect(limitTrackByIp(headers, null).limited).toBe(false)
    for (let i = 0; i < TRACK_PER_MINUTE + 5; i++) expect(limitTrackByIp(new Headers(), 'vercel').limited).toBe(false)
  })

  it('counts every address of one IPv6 /64 together, and another /64 apart', () => {
    for (let i = 0; i < TRACK_PER_MINUTE; i++) {
      expect(limitTrackByIp(vercelHeaders(`2001:db8:aaaa:1::${(i + 1).toString(16)}`), 'vercel').limited).toBe(false)
    }
    expect(limitTrackByIp(vercelHeaders('2001:db8:aaaa:1:ffff::1'), 'vercel').limited).toBe(true)
    expect(limitTrackByIp(vercelHeaders('2001:db8:aaaa:2::1'), 'vercel').limited).toBe(false)
  })

  it('fails open when the limiter throws', () => {
    h.memoryThrows = true
    expect(limitTrackByIp(vercelHeaders(freshIp()), 'vercel')).toEqual({ limited: false })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Rate limit (track)'))
    // The log never names the address.
    expect(String(vi.mocked(console.error).mock.calls[0][0])).not.toMatch(/198\.51/)
  })
})

describe('limitOgPreviewByIp', () => {
  it('stays in memory below the shared-check threshold', async () => {
    const headers = vercelHeaders(freshIp())
    for (let i = 1; i < OG_PREVIEW_SHARED_CHECK_FROM; i++) {
      expect(await limitOgPreviewByIp(headers, { platform: 'vercel' })).toEqual({ limited: false })
    }
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('also counts in Postgres from the threshold on, under the hashed address', async () => {
    const ip = freshIp()
    const headers = vercelHeaders(ip)
    for (let i = 0; i < OG_PREVIEW_SHARED_CHECK_FROM; i++) await limitOgPreviewByIp(headers, { platform: 'vercel' })
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('rate_limit_take', {
      p_bucket: OG_PREVIEW_IP_RATE_LIMIT.name,
      p_key: hashIpKey(`4:${ip}`),
      p_windows: [60, 3600],
      p_maxes: [OG_PER_MINUTE, OG_PREVIEW_IP_LIMITS[1].max],
    })
    // The stored key never holds the address itself.
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain(ip)
  })

  it('is limited when the shared limiter says so (a flood spread over instances)', async () => {
    const headers = vercelHeaders(freshIp())
    h.rpc.mockImplementation(async () => ({ data: [{ allowed: false, retry_after_seconds: 12 }], error: null }))
    for (let i = 1; i < OG_PREVIEW_SHARED_CHECK_FROM; i++) await limitOgPreviewByIp(headers, { platform: 'vercel' })
    expect(await limitOgPreviewByIp(headers, { platform: 'vercel' })).toEqual({ limited: true, retryAfterSeconds: 12 })
  })

  it('refuses over the per-minute limit without asking Postgres', async () => {
    const headers = vercelHeaders(freshIp())
    for (let i = 0; i < OG_PER_MINUTE; i++) expect((await limitOgPreviewByIp(headers, { platform: 'vercel' })).limited).toBe(false)
    const calls = h.rpc.mock.calls.length
    expect(await limitOgPreviewByIp(headers, { platform: 'vercel' })).toEqual({ limited: true, retryAfterSeconds: 30 })
    expect(h.rpc.mock.calls.length).toBe(calls)
  })

  it('uses a client it is given', async () => {
    const rpc = vi.fn(async () => allowedRpc())
    const headers = vercelHeaders(freshIp())
    for (let i = 0; i < OG_PREVIEW_SHARED_CHECK_FROM; i++) {
      await limitOgPreviewByIp(headers, { platform: 'vercel', client: { rpc } as unknown as SupabaseClient })
    }
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('never limits a request without a trusted address', async () => {
    for (let i = 0; i < OG_PER_MINUTE + 5; i++) {
      expect((await limitOgPreviewByIp(vercelHeaders('203.0.113.200'), { platform: null })).limited).toBe(false)
    }
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('reads the platform from the environment by default', async () => {
    // Tests run off-platform, so the default is "no trusted address".
    for (let i = 0; i < OG_PER_MINUTE + 1; i++) expect((await limitOgPreviewByIp(vercelHeaders('203.0.113.201'))).limited).toBe(false)
  })

  it('fails open when the shared limiter errors or throws', async () => {
    const headers = vercelHeaders(freshIp())
    h.rpc.mockImplementation(async () => ({ data: null, error: { code: '55P03' } }))
    for (let i = 0; i < OG_PREVIEW_SHARED_CHECK_FROM + 3; i++) {
      expect(await limitOgPreviewByIp(headers, { platform: 'vercel' })).toEqual({ limited: false })
    }
    h.rpc.mockRejectedValue(new Error('network'))
    expect(await limitOgPreviewByIp(headers, { platform: 'vercel' })).toEqual({ limited: false })
  })

  it('fails open when the in-memory limiter throws', async () => {
    h.memoryThrows = true
    expect(await limitOgPreviewByIp(vercelHeaders(freshIp()), { platform: 'vercel' })).toEqual({ limited: false })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Rate limit (og-preview)'))
  })

  it('keeps the per-instance limit when there is no secret to hash with', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const headers = vercelHeaders(freshIp())
    for (let i = 0; i < OG_PER_MINUTE; i++) expect((await limitOgPreviewByIp(headers, { platform: 'vercel' })).limited).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
    expect((await limitOgPreviewByIp(headers, { platform: 'vercel' })).limited).toBe(true)
  })

  it('counts an IPv6 /64 as one client', async () => {
    for (let i = 0; i < OG_PER_MINUTE; i++) {
      await limitOgPreviewByIp(vercelHeaders(`2001:db8:bbbb:1::${(i + 1).toString(16)}`), { platform: 'vercel' })
    }
    expect((await limitOgPreviewByIp(vercelHeaders('2001:db8:bbbb:1:abcd::9'), { platform: 'vercel' })).limited).toBe(true)
    expect((await limitOgPreviewByIp(vercelHeaders('2001:db8:bbbb:2::9'), { platform: 'vercel' })).limited).toBe(false)
  })
})

describe('routes when limited', () => {
  const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'

  beforeEach(() => {
    vi.stubEnv('VERCEL', '1')
    vi.stubEnv('DEPLOY_PLATFORM', '')
  })

  function trackRequest(ip: string) {
    return new NextRequest('https://tabmerger.test/api/track', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-vercel-forwarded-for': ip, origin: ORIGIN },
      body: JSON.stringify({ event: 'group_created', client_id: 'abc-123' }),
    })
  }

  function ogRequest(ip: string, url = 'not a url') {
    return new NextRequest('https://tabmerger.test/api/og-preview', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-vercel-forwarded-for': ip, origin: ORIGIN },
      body: JSON.stringify({ url }),
    })
  }

  it('track: 429 with no body and no GA call over the limit; 204 below it', async () => {
    vi.stubEnv('GA_EXTENSION_MEASUREMENT_ID', 'G-EXT123')
    vi.stubEnv('GA_EXTENSION_API_SECRET', 'secret123')
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const ip = freshIp()

    const ok = await trackPost(trackRequest(ip))
    expect(ok.status).toBe(204)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    for (let i = 1; i < TRACK_PER_MINUTE; i++) limitTrackByIp(vercelHeaders(ip), 'vercel')
    fetchMock.mockClear()
    const limited = await trackPost(trackRequest(ip))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('30')
    expect(await limited.text()).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
    // A different client is unaffected.
    expect((await trackPost(trackRequest(freshIp()))).status).toBe(204)
  })

  it('track: does not count anything while GA is not configured', async () => {
    vi.stubEnv('GA_EXTENSION_MEASUREMENT_ID', '')
    vi.stubEnv('GA_EXTENSION_API_SECRET', '')
    const ip = freshIp()
    for (let i = 0; i < TRACK_PER_MINUTE + 1; i++) expect((await trackPost(trackRequest(ip))).status).toBe(204)
  })

  it('og-preview: 429 with the empty preview, no-store and no fetch over the limit', async () => {
    const ip = freshIp()
    // Below the limit the request goes on to its usual answer (400 for this invalid URL).
    const below = await ogPreviewPost(ogRequest(ip))
    expect(below.status).toBe(400)

    for (let i = 1; i < OG_PER_MINUTE; i++) await limitOgPreviewByIp(vercelHeaders(ip), { platform: 'vercel' })
    h.lookup.mockClear()
    const limited = await ogPreviewPost(ogRequest(ip, 'https://example.com/'))
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ ogImage: null, description: null })
    expect(limited.headers.get('Cache-Control')).toBe('no-store')
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(limited.headers.get('Retry-After')).toBe('30')
    expect(h.lookup).not.toHaveBeenCalled()
  })
})
