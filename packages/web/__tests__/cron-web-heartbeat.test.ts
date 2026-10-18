/**
 * GET /api/cron/web-heartbeat: rejects anything without `Authorization: Bearer <CRON_SECRET>`,
 * and with it sends one `web_heartbeat` event to the web GA4 property.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ANALYTICS_EVENTS } from '@tabmerger/shared'
import { GET } from '@/app/api/cron/web-heartbeat/route'
import { _resetHealthCacheForTests } from '@/lib/health'

const SECRET = 'cron_secret_for_tests'
const fetchMock = vi.fn()

function request(authorization?: string) {
  return new NextRequest('http://localhost/api/cron/web-heartbeat', {
    headers: authorization ? { authorization } : {},
  })
}

/** The Measurement Protocol calls only (the health check's Supabase call would be another fetch). */
function gaCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith('https://www.google-analytics.com/'))
}

beforeEach(() => {
  _resetHealthCacheForTests()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-WEB123')
  vi.stubEnv('GA_API_SECRET', 'web_secret')
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc1234def')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('GET /api/cron/web-heartbeat', () => {
  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer nope'],
    ['the secret without the Bearer scheme', SECRET],
    ['a longer value that starts with the secret', `Bearer ${SECRET}x`],
  ])('rejects %s with 401 and sends nothing', async (_label, header) => {
    const res = await GET(request(header))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects every request when CRON_SECRET is not set (fails closed)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(request('Bearer '))).status).toBe(401)
    expect((await GET(request('Bearer undefined'))).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends web_heartbeat to the web GA4 property with the right bearer', async () => {
    const res = await GET(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: true, health: { commit: 'abc1234', supabase: 'unconfigured' } })
    const calls = gaCalls()
    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.google-analytics.com/mp/collect?measurement_id=G-WEB123&api_secret=web_secret')
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: 'web-heartbeat.production',
      events: [
        {
          name: ANALYTICS_EVENTS.webHeartbeat,
          params: { environment: 'production', supabase: 'unconfigured', commit: 'abc1234' },
        },
      ],
    })
  })

  it('answers 503 without calling GA when the web stream is not configured', async () => {
    vi.stubEnv('GA_API_SECRET', '')
    const res = await GET(request(`Bearer ${SECRET}`))
    expect(res.status).toBe(503)
    expect(gaCalls()).toHaveLength(0)
  })

  it('answers 502 when GA refuses or is unreachable, so the cron run shows as failed', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(502)
    fetchMock.mockRejectedValue(new Error('down'))
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(502)
  })
})
