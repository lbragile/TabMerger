/**
 * Tests for app/api/track/route.ts — the GA4 Measurement Protocol proxy the extension
 * POSTs to, so the real measurement ID / API secret never ship in the extension bundle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/track/route'

const mockFetch = vi.fn().mockResolvedValue({ ok: true })

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/track', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockClear()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  it('forwards the event to GA4 collect endpoint with correct params', async () => {
    process.env.GA_EXTENSION_MEASUREMENT_ID = 'G-EXT123'
    process.env.GA_EXTENSION_API_SECRET = 'secret123'

    const res = await POST(
      makeRequest({ event: 'group_created', params: { count: 3 }, client_id: 'abc-123' })
    )

    expect(res.status).toBe(204)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://www.google-analytics.com/mp/collect?measurement_id=G-EXT123&api_secret=secret123',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'abc-123',
          events: [{ name: 'group_created', params: { count: 3 } }],
        }),
      })
    )
  })

  it('no-ops without calling fetch when env vars are unset', async () => {
    delete process.env.GA_EXTENSION_MEASUREMENT_ID
    delete process.env.GA_EXTENSION_API_SECRET

    const res = await POST(makeRequest({ event: 'group_created', client_id: 'abc-123' }))

    expect(res.status).toBe(204)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
