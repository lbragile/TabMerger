/**
 * Unit tests for POST /api/og-preview — SSRF guards + og:image extraction.
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

function req(url: string | undefined, { badJson = false }: { badJson?: boolean } = {}) {
  return new NextRequest('http://localhost/api/og-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: badJson ? '{not valid json' : JSON.stringify({ url }),
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) // public IP by default
})

describe('POST /api/og-preview', () => {
  it('rejects a missing url field', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req(undefined))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ogImage: null, description: null })
  })

  it('rejects an invalid JSON body', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req(undefined, { badJson: true }))
    expect(res.status).toBe(400)
  })

  it('rejects non-http(s) protocols', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('javascript:alert(1)'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ogImage: null, description: null })
  })

  it('rejects an unparseable url', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('not a url'))
    expect(res.status).toBe(400)
  })

  it('rejects a private-IP literal URL', async () => {
    const { httpRequest, httpsRequest } = mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('http://192.168.1.5/page'))
    expect(res.status).toBe(400)
    expect(httpRequest).not.toHaveBeenCalled()
    expect(httpsRequest).not.toHaveBeenCalled()
  })

  it('rejects loopback', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('http://127.0.0.1/page'))
    expect(res.status).toBe(400)
  })

  it('rejects a hostname that resolves to the cloud metadata endpoint', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    const { httpRequest, httpsRequest } = mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('http://metadata.internal-service.example/page'))
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
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('http://multi-answer.example/page'))
    expect(res.status).toBe(400)
  })

  it('rejects localhost', async () => {
    mockRequestModules({ statusCode: 200, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('http://localhost:3000/page'))
    expect(res.status).toBe(400)
  })

  it('extracts og:image from sample HTML on the happy path', async () => {
    const html = `<html><head><meta property="og:image" content="https://example.com/img.png" /></head><body></body></html>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/article'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/img.png', description: null })
  })

  it('sets Cache-Control: no-store on every response', async () => {
    const html = `<head><meta property="og:image" content="https://example.com/img.png" /></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/cache-check'))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('never caches — two identical requests both fetch upstream', async () => {
    const html = `<head><meta property="og:image" content="https://example.com/img.png" /></head>`
    const { httpsRequest } = mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    await POST(req('https://example.com/repeat'))
    await POST(req('https://example.com/repeat'))
    expect(httpsRequest).toHaveBeenCalledTimes(2)
  })

  // Meta content is HTML-attribute text: Wikipedia's og:image arrives with `&amp;`, which
  // used to be passed through and turned into a different (often broken) image URL.
  it('decodes HTML entities in the image URL and description', async () => {
    const html = `<head><meta property="og:image" content="https://example.com/img.png?a=1&amp;b=2&#38;c=3" /><meta property="og:description" content="Tabs &amp; windows, &quot;tamed&quot; &#x2014; fast" /></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/entities'))
    expect(await res.json()).toEqual({
      ogImage: 'https://example.com/img.png?a=1&b=2&c=3',
      description: 'Tabs & windows, "tamed" — fast',
    })
  })

  it('falls back to twitter:image when og:image is absent', async () => {
    const html = `<head><meta name="twitter:image" content="https://example.com/tw.png"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/article2'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/tw.png', description: null })
  })

  it('returns null ogImage without leaking error details when the upstream fetch fails', async () => {
    mockRequestModules({ statusCode: 500, headers: {}, body: '' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/broken'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ogImage: null, description: null })
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
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/redirector'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/final.png', description: null })
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
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/evil-redirector'))
    const body = await res.json()
    expect(body).toEqual({ ogImage: null, description: null })
    expect(call).toBe(1) // never followed the redirect to the private host
  })

  it('extracts description, preferring og:description over the plain description tag', async () => {
    const html = `<head><meta name="description" content="plain"><meta property="og:description" content="og desc"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/desc'))
    expect(await res.json()).toEqual({ ogImage: null, description: 'og desc' })
  })

  it('falls back to the plain description tag when og:description is absent', async () => {
    const html = `<head><meta name="description" content="plain desc"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/desc2'))
    expect(await res.json()).toEqual({ ogImage: null, description: 'plain desc' })
  })

  it('truncates an absurdly long description to 500 chars', async () => {
    const longDesc = 'a'.repeat(1000)
    const html = `<head><meta name="description" content="${longDesc}"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/desc3'))
    const body = await res.json()
    expect(body.description).toHaveLength(500)
  })

  // MDN serves og:image with `name=` instead of `property=`.
  it('accepts og:image declared with name= (the MDN case)', async () => {
    const html = `<head><meta name="og:image" content="https://developer.mozilla.org/mdn-social-image.46ac2375.png" /></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://developer.mozilla.org/en-US/'))
    expect(await res.json()).toEqual({
      ogImage: 'https://developer.mozilla.org/mdn-social-image.46ac2375.png',
      description: null,
    })
  })

  it('accepts twitter:image declared with property= instead of name=', async () => {
    const html = `<head><meta property="twitter:image" content="https://example.com/tw2.png"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/tw-property'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/tw2.png', description: null })
  })

  it('accepts og:image with content before the property attribute (reversed order)', async () => {
    const html = `<head><meta content="https://example.com/reversed.png" property="og:image"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/reversed'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/reversed.png', description: null })
  })

  it('falls back to <link rel="image_src"> when no og/twitter image tag exists', async () => {
    const html = `<head><link rel="image_src" href="https://example.com/legacy.png"></head>`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/legacy'))
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/legacy.png', description: null })
  })

  it('resolves a relative og:image URL against the final (post-redirect) URL', async () => {
    let call = 0
    const requestFn = vi.fn((_options: unknown, callback: (res: unknown) => void) => {
      const reqEmitter = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
      reqEmitter.end = () => {
        queueMicrotask(() => {
          call++
          if (call === 1) {
            const im = fakeIncomingMessage({ statusCode: 302, headers: { location: 'https://final.example/page' }, body: '' })
            callback(im)
          } else {
            const html = `<head><meta property="og:image" content="/images/relative.png"></head>`
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
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://example.com/redirect-relative'))
    expect(await res.json()).toEqual({ ogImage: 'https://final.example/images/relative.png', description: null })
  })

  it('returns null preview for a non-HTML content-type instead of regex-ing it', async () => {
    mockRequestModules({ statusCode: 200, headers: { 'content-type': 'text/markdown' }, body: '# no meta tags here' })
    const { POST } = await import('@/app/api/og-preview/route')
    const res = await POST(req('https://vercel.com/docs'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ogImage: null, description: null })
  })

  it('handles a pathological ~2MB unclosed head region quickly instead of catastrophically backtracking', async () => {
    // A single unclosed `<meta` tag followed by tens of thousands of
    // `property="og:image"` occurrences — the shape that made the old
    // per-attribute-name backtracking regexes take ~O(n × occurrences).
    const html = `<head><meta ${'property="og:image" '.repeat(100_000)}`
    mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    const start = Date.now()
    const res = await POST(req('https://example.com/pathological'))
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
    expect(await res.json()).toEqual({ ogImage: null, description: null })
  })

  it('sends an Accept header requesting HTML', async () => {
    const html = `<head><meta property="og:image" content="https://example.com/img.png"></head>`
    const { httpsRequest } = mockRequestModules({ statusCode: 200, headers: {}, body: html })
    const { POST } = await import('@/app/api/og-preview/route')
    await POST(req('https://example.com/accept-check'))
    const options = httpsRequest.mock.calls[0][0] as { headers: Record<string, string> }
    expect(options.headers.Accept).toBe('text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')
    expect(options.headers['Accept-Language']).toBe('en-US,en;q=0.9')
  })
})
