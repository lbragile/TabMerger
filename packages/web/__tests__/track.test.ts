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
    delete process.env.VERCEL_ENV
    delete process.env.NEXT_PUBLIC_VERCEL_ENV
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
          events: [{ name: 'group_created', params: { count: 3, environment: 'development' } }],
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

  describe('with GA configured', () => {
    beforeEach(() => {
      process.env.GA_EXTENSION_MEASUREMENT_ID = 'G-EXT123'
      process.env.GA_EXTENSION_API_SECRET = 'secret123'
    })

    const sentBody = () => JSON.parse(mockFetch.mock.calls[0][1].body as string)

    it('forwards string and number params unchanged, plus environment', async () => {
      const params = { feature_name: 'organize', count: 1, ratio: 0.5 }
      const res = await POST(makeRequest({ event: 'ai_feature_used', params, client_id: 'abc-123' }))

      expect(res.status).toBe(204)
      expect(sentBody()).toEqual({
        client_id: 'abc-123',
        events: [{ name: 'ai_feature_used', params: { ...params, environment: 'development' } }],
      })
    })

    it('adds environment to an event with no params', async () => {
      const res = await POST(makeRequest({ event: 'extension_opened', client_id: 'abc-123' }))

      expect(res.status).toBe(204)
      expect(sentBody()).toEqual({
        client_id: 'abc-123',
        events: [{ name: 'extension_opened', params: { environment: 'development' } }],
      })
    })

    it.each(['production', 'preview'])('stamps environment=%s from VERCEL_ENV', async (env) => {
      process.env.VERCEL_ENV = env
      await POST(makeRequest({ event: 'extension_installed', client_id: 'abc-123' }))

      expect(sentBody().events[0].params).toEqual({ environment: env })
    })

    it('overrides a client-sent environment param with the server value', async () => {
      process.env.VERCEL_ENV = 'production'
      await POST(makeRequest({ event: 'group_created', client_id: 'abc-123', params: { environment: 'fake' } }))

      expect(sentBody().events[0].params).toEqual({ environment: 'production' })
    })

    it('forwards only the event, params and client_id fields', async () => {
      await POST(makeRequest({ event: 'group_created', client_id: 'abc-123', user_id: 'someone', extra: 1 }))

      expect(sentBody()).toEqual({
        client_id: 'abc-123',
        events: [{ name: 'group_created', params: { environment: 'development' } }],
      })
    })

    it('accepts names and values at the limits', async () => {
      const params = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`p${i}`, 'v'.repeat(100)]))
      const res = await POST(makeRequest({ event: 'e'.repeat(40), params, client_id: 'c'.repeat(100) }))

      expect(res.status).toBe(204)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('forwards 24 client params plus environment as 25 params', async () => {
      const params = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`p${i}`, i]))
      const res = await POST(makeRequest({ event: 'group_created', params, client_id: 'abc-123' }))

      expect(res.status).toBe(204)
      const sent = sentBody().events[0].params
      expect(Object.keys(sent)).toHaveLength(25)
      expect(sent).toEqual({ ...params, environment: 'development' })
    })

    it('returns 400 without calling GA for 25 client params (no room for environment)', async () => {
      const params = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, i]))
      const res = await POST(makeRequest({ event: 'group_created', params, client_id: 'abc-123' }))

      expect(res.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('accepts 24 params plus a client environment, replacing it with the server value', async () => {
      process.env.VERCEL_ENV = 'production'
      const params = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`p${i}`, i]))
      const res = await POST(
        makeRequest({ event: 'group_created', params: { ...params, environment: 'fake' }, client_id: 'abc-123' })
      )

      expect(res.status).toBe(204)
      const sent = sentBody().events[0].params
      expect(Object.keys(sent)).toHaveLength(25)
      expect(sent).toEqual({ ...params, environment: 'production' })
    })

    it('returns 400 for a body that is not JSON', async () => {
      const res = await POST(
        new NextRequest('http://localhost/api/track', { method: 'POST', body: '{"event": "group_cre' })
      )

      expect(res.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it.each([
      ['a JSON null body', null],
      ['a JSON array body', []],
      ['a JSON string body', 'group_created'],
      ['a missing event', { client_id: 'abc-123' }],
      ['an event name with a space', { event: 'group created', client_id: 'abc-123' }],
      ['an event name starting with a digit', { event: '1group', client_id: 'abc-123' }],
      ['an event name with punctuation', { event: 'group-created&x=1', client_id: 'abc-123' }],
      ['an event name over 40 characters', { event: 'e'.repeat(41), client_id: 'abc-123' }],
      ['a non-string event', { event: 7, client_id: 'abc-123' }],
      ['a missing client_id', { event: 'group_created' }],
      ['an empty client_id', { event: 'group_created', client_id: '' }],
      ['a client_id over 100 characters', { event: 'group_created', client_id: 'c'.repeat(101) }],
      ['a non-string client_id', { event: 'group_created', client_id: 123 }],
      ['a nested param object', { event: 'group_created', client_id: 'abc-123', params: { a: { b: 1 } } }],
      ['an array param value', { event: 'group_created', client_id: 'abc-123', params: { a: [1] } }],
      ['a boolean param value', { event: 'group_created', client_id: 'abc-123', params: { a: true } }],
      ['a null param value', { event: 'group_created', client_id: 'abc-123', params: { a: null } }],
      [
        'a param value over 100 characters',
        { event: 'group_created', client_id: 'abc-123', params: { a: 'v'.repeat(101) } },
      ],
      ['a param name with punctuation', { event: 'group_created', client_id: 'abc-123', params: { 'a.b': 1 } }],
      ['params that are an array', { event: 'group_created', client_id: 'abc-123', params: [1, 2] }],
      [
        'more than 25 params',
        {
          event: 'group_created',
          client_id: 'abc-123',
          params: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`p${i}`, i])),
        },
      ],
    ])('returns 400 without calling GA for %s', async (_label, body) => {
      const res = await POST(makeRequest(body))

      expect(res.status).toBe(400)
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })
})
