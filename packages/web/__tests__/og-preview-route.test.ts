/**
 * Unit tests for GET /api/og-preview — SSRF guards + og:image extraction.
 *
 * `node:dns/promises` is mocked so hostname resolution is deterministic and
 * offline. `node:https`/`node:http` `request` are mocked (not `fetch` — the
 * route uses the raw request APIs directly so it can pin the TCP connection
 * to a pre-validated address and avoid DNS-rebinding/redirect SSRF).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { EventEmitter } from 'node:events'

const mockLookup = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: (...a: unknown[]) => mockLookup(...a),
  default: { lookup: (...a: unknown[]) => mockLookup(...a) },
}))

interface MockResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

function fakeIncomingMessage(res: MockResponse) {
  const emitter = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void; destroy: () => void }
  emitter.statusCode = res.statusCode
  emitter.headers = res.headers
  emitter.resume = () => {}
  emitter.destroy = () => {}
  return emitter
}

/** Mocks both node:http and node:https `request` to return `res`, invoking the callback asynchronously like the real API. */
function mockRequestModules(res: MockResponse) {
  const makeRequestFn = () =>
    vi.fn((_options: unknown, callback: (res: unknown) => void) => {
      const reqEmitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      reqEmitter.end = () => {
        queueMicrotask(() => {
          const im = fakeIncomingMessage(res)
          callback(im)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            queueMicrotask(() => {
              im.emit('data', Buffer.from(res.body))
              im.emit('end')
            })
          }
        })
      }
      reqEmitter.destroy = () => {}
      return reqEmitter
    })
  const httpRequest = makeRequestFn()
  const httpsRequest = makeRequestFn()
  vi.doMock('node:http', () => ({ request: httpRequest, default: { request: httpRequest } }))
  vi.doMock('node:https', () => ({ request: httpsRequest, default: { request: httpsRequest } }))
  return { httpRequest, httpsRequest }
}

function req(url: string) {
  return new NextRequest(`http://localhost/api/og-preview?url=${encodeURIComponent(url)}`)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) // public IP by default
})

describe('GET /api/og-preview', () => {
  it('rejects non-http(s) protocols', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('javascript:alert(1)'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ogImage: null })
  })

  it('rejects an unparseable url', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('not a url'))
    expect(res.status).toBe(400)
  })

  it('rejects a private-IP literal URL', async () => {
    const { httpRequest, httpsRequest } = mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('http://192.168.1.5/page'))
    expect(res.status).toBe(400)
    expect(httpRequest).not.toHaveBeenCalled()
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('rejects loopback', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('http://127.0.0.1/page'))
    expect(res.status).toBe(400)
  })

  it('rejects a hostname that resolves to the cloud metadata endpoint', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const { httpRequest, httpsRequest } = mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('http://metadata.internal-service.example/page'))
    expect(res.status).toBe(400)
    expect(httpRequest).not.toHaveBeenCalled()
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('rejects a hostname where only one of several resolved addresses is private (rebinding-style answer)', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('http://multi-answer.example/page'))
    expect(res.status).toBe(400)
  })

  it('rejects localhost', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('http://localhost:3000/page'))
    expect(res.status).toBe(400)
  })

  it('extracts og:image from sample HTML on the happy path', async () => {
    const html = `<html><head><meta property="og:image" content="https://example.com/img.png" /></head><body></body></html>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('https://example.com/article'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/img.png' })
  })

  it('falls back to twitter:image when og:image is absent', async () => {
    const html = `<head><meta name="twitter:image" content="https://example.com/tw.png"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('https://example.com/article2'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/tw.png' })
  })

  it('returns null ogImage without leaking error details when the upstream fetch fails', async () => {
    mockRequestModules({ statusCode: 500, headers: {}, body: '' })
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('https://example.com/broken'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ogImage: null })
  })

  it('follows a redirect to a public host and re-validates it', async () => {
    let call = 0
    const requestFn = vi.fn((options: { hostname: string }, callback: (res: unknown) => void) => {
      const reqEmitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      reqEmitter.end = () => {
        queueMicrotask(() => {
          call++
          if (call === 1) {
            const im = fakeIncomingMessage({ statusCode: 302, headers: { location: 'https://example.com/final' }, body: '' })
            callback(im)
          } else {
            const html = `<head><meta property="og:image" content="https://example.com/final.png"></head>`
            const im = fakeIncomingMessage({ statusCode: 200, headers: {}, body: html })
            callback(im)
            queueMicrotask(() => {
              im.emit('data', Buffer.from(html))
              im.emit('end')
            })
          }
        })
      }
      reqEmitter.destroy = () => {}
      return reqEmitter
    })
    vi.doMock('node:http', () => ({ request: requestFn, default: { request: requestFn } }))
    vi.doMock('node:https', () => ({ request: requestFn, default: { request: requestFn } }))
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('https://example.com/redirector'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/final.png' })
    expect(requestFn).toHaveBeenCalledTimes(2)
  })

  it('blocks a redirect to a private address instead of following it', async () => {
    let call = 0
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === 'internal.example') return [{ address: '10.0.0.9', family: 4 }]
      return [{ address: '93.184.216.34', family: 4 }]
    })
    const requestFn = vi.fn((_options: unknown, callback: (res: unknown) => void) => {
      const reqEmitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      reqEmitter.end = () => {
        queueMicrotask(() => {
          call++
          const im = fakeIncomingMessage({ statusCode: 302, headers: { location: 'http://internal.example/secret' }, body: '' })
          callback(im)
        })
      }
      reqEmitter.destroy = () => {}
      return reqEmitter
    })
    vi.doMock('node:http', () => ({ request: requestFn, default: { request: requestFn } }))
    vi.doMock('node:https', () => ({ request: requestFn, default: { request: requestFn } }))
    const { GET } = await import('@/app/api/og-preview/route')
    const res = await GET(req('https://example.com/evil-redirector'))
    const body = await res.json()
    expect(body).toEqual({ ogImage: null })
    expect(call).toBe(1) // never followed the redirect to the private host
  })
})
