/**
 * POST /api/og-preview upstream fetch path, with DNS and node:http(s) mocked (no network).
 * SSRF guards (private addresses, redirects), response handling, and the "never leak error
 * details" rule.
 */
import { EventEmitter } from 'node:events'
import { gzipSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Reply =
  | { status: number; headers?: Record<string, string>; body?: Buffer | string; chunks?: Buffer[] }
  | { error: Error }
  | { timeout: true }

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  replies: [] as unknown[],
  requests: [] as Record<string, unknown>[],
}))

vi.mock('node:dns/promises', () => ({ lookup: h.lookup, default: { lookup: h.lookup } }))

function fakeRequest(options: Record<string, unknown>, cb: (res: unknown) => void) {
  h.requests.push(options)
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: (e?: Error) => void }
  req.destroy = (e?: Error) => {
    if (e) queueMicrotask(() => req.emit('error', e))
  }
  req.end = () => {
    const reply = h.replies.shift() as Reply
    queueMicrotask(() => {
      if ('error' in reply) return req.emit('error', reply.error)
      if ('timeout' in reply) return req.emit('timeout')
      const res = new EventEmitter() as EventEmitter & Record<string, unknown>
      res.statusCode = reply.status
      res.headers = reply.headers ?? {}
      res.resume = vi.fn()
      res.destroy = vi.fn()
      cb(res)
      const chunks = reply.chunks ?? (reply.body === undefined ? [] : [Buffer.from(reply.body)])
      for (const c of chunks) res.emit('data', c)
      res.emit('end')
    })
  }
  return req
}
vi.mock('node:http', () => ({ request: fakeRequest, default: { request: fakeRequest } }))
vi.mock('node:https', () => ({ request: fakeRequest, default: { request: fakeRequest } }))

import { POST } from '@/app/api/og-preview/route'

const post = (url: string) =>
  POST(
    new NextRequest('http://localhost/api/og-preview', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ url }),
    })
  )

const html = (head: string) => ({ status: 200, headers: { 'content-type': 'text/html' }, body: `<html><head>${head}</head></html>` })
const PUBLIC = [{ address: '93.184.216.34', family: 4 }]

beforeEach(() => {
  h.lookup.mockReset().mockResolvedValue(PUBLIC)
  h.replies.length = 0
  h.requests.length = 0
})

describe('POST /api/og-preview upstream fetch', () => {
  it('extracts og:image and the decoded description, with no-store and open CORS', async () => {
    h.replies.push(
      html('<meta property="og:image" content="/img.png"><meta name="description" content="Tom &amp; Jerry">')
    )
    const res = await post('https://example.com/page')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ogImage: 'https://example.com/img.png', description: 'Tom & Jerry', imageKind: 'preview' })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('pins the connection to the validated address and sends no cookies or auth', async () => {
    h.replies.push(html(''))
    await post('https://example.com/page?x=1')
    const options = h.requests[0] as { lookup: (...a: unknown[]) => void; headers: Record<string, string>; servername: string; path: string }
    const cb = vi.fn()
    options.lookup('example.com', {}, cb)
    expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(options.servername).toBe('example.com')
    expect(options.path).toBe('/page?x=1')
    expect(Object.keys(options.headers).map((k) => k.toLowerCase())).not.toContain('cookie')
    expect(Object.keys(options.headers).map((k) => k.toLowerCase())).not.toContain('authorization')
  })

  it('falls back to the icon (imageKind icon) when no image meta exists', async () => {
    h.replies.push(html('<link rel="apple-touch-icon" href="/icon.png" sizes="180x180">'))
    const body = await (await post('https://example.com/')).json()
    expect(body).toMatchObject({ ogImage: 'https://example.com/icon.png', imageKind: 'icon' })
  })

  it('decodes a gzip response', async () => {
    const zipped = gzipSync(Buffer.from('<head><meta property="og:image" content="https://cdn.example.com/a.png"></head>'))
    h.replies.push({ status: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' }, body: zipped })
    expect((await (await post('https://example.com/')).json()).ogImage).toBe('https://cdn.example.com/a.png')
  })

  it('falls back to the raw text for a corrupt gzip body instead of failing', async () => {
    h.replies.push({
      status: 200,
      headers: { 'content-type': 'text/html', 'content-encoding': 'gzip' },
      body: '<head><meta property="og:image" content="https://cdn.example.com/b.png"></head>',
    })
    expect((await (await post('https://example.com/')).json()).ogImage).toBe('https://cdn.example.com/b.png')
  })

  it('stops reading past the size cap but still parses what it has', async () => {
    const head = Buffer.from('<head><meta property="og:image" content="https://cdn.example.com/c.png"></head>')
    h.replies.push({ status: 200, headers: { 'content-type': 'text/html' }, chunks: [head, Buffer.alloc(3 * 1024 * 1024, 'a')] })
    const res = await post('https://example.com/')
    expect(res.status).toBe(200)
    expect((await res.json()).ogImage).toBe('https://cdn.example.com/c.png')
  })

  it('answers empty for a non-HTML response', async () => {
    h.replies.push({ status: 200, headers: { 'content-type': 'text/markdown' }, body: '# hi' })
    expect(await (await post('https://example.com/')).json()).toEqual({ ogImage: null, description: null, imageKind: 'preview' })
  })

  it('tries a response with no content-type', async () => {
    h.replies.push({ status: 200, body: '<head><meta property="og:image" content="https://cdn.example.com/d.png"></head>' })
    expect((await (await post('https://example.com/')).json()).ogImage).toBe('https://cdn.example.com/d.png')
  })

  it.each([
    ['an upstream 500', { status: 500 }],
    ['an upstream 404', { status: 404 }],
    ['a network error', { error: new Error('connect ECONNREFUSED 10.1.2.3:443 secret-detail') }],
    ['a timeout', { timeout: true }],
  ] as [string, Reply][])('answers 200 with nothing and leaks no detail on %s', async (_l, reply) => {
    h.replies.push(reply)
    const res = await post('https://example.com/')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ogImage: null, description: null, imageKind: 'preview' })
    expect(text).not.toMatch(/ECONNREFUSED|secret-detail|10\.1\.2\.3/)
  })

  describe('SSRF guards', () => {
    it.each([
      'http://localhost/',
      'http://foo.local/',
      'http://127.0.0.1/',
      'http://10.0.0.5/',
      'http://172.16.0.1/',
      'http://172.31.255.255/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
    ])('rejects %s without any connection', async (url) => {
      // URL.hostname keeps the brackets of an IPv6 literal, so the literal reaches DNS as-is,
      // where the real resolver rejects it (ENOTFOUND). Mirror that here.
      h.lookup.mockImplementation(async (host: string) => {
        if (host.startsWith('[')) throw new Error('ENOTFOUND')
        return PUBLIC
      })
      const res = await post(url)
      expect(res.status).toBe(400)
      expect(h.requests).toHaveLength(0)
    })

    it('does not block public neighbours of the private ranges', async () => {
      for (const ip of ['172.15.0.1', '172.32.0.1', '192.169.0.1']) {
        h.replies.push(html(''))
        h.lookup.mockResolvedValue([{ address: ip, family: 4 }])
        expect((await post(`http://${ip}/`)).status).toBe(200)
      }
    })

    it('rejects a host that resolves to a private address', async () => {
      h.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
      expect((await post('https://rebind.example.com/')).status).toBe(400)
      expect(h.requests).toHaveLength(0)
    })

    it('rejects a host when ANY resolved address is private (round robin)', async () => {
      h.lookup.mockResolvedValue([PUBLIC[0], { address: '192.168.0.9', family: 4 }])
      expect((await post('https://mixed.example.com/')).status).toBe(400)
    })

    it('rejects an unresolvable host and one with no addresses', async () => {
      h.lookup.mockRejectedValueOnce(new Error('ENOTFOUND'))
      expect((await post('https://nope.example.com/')).status).toBe(400)
      h.lookup.mockResolvedValueOnce([])
      expect((await post('https://empty.example.com/')).status).toBe(400)
    })

    it.each([
      ['an IPv4-mapped loopback (hex)', [{ address: '::ffff:7f00:1', family: 6 }]],
      ['an IPv4-mapped metadata address (dotted)', [{ address: '::ffff:169.254.169.254', family: 6 }]],
      ['an unspecified address', [{ address: '::', family: 6 }]],
      ['a NAT64 address embedding a private IPv4', [{ address: '64:ff9b::a00:1', family: 6 }]],
      ['a 6to4 address embedding loopback', [{ address: '2002:7f00:1::', family: 6 }]],
      ['a link-local address above fe80:', [{ address: 'febf::1', family: 6 }]],
      ['a CGNAT address', [{ address: '100.64.0.1', family: 4 }]],
      ['a benchmarking address', [{ address: '198.18.0.1', family: 4 }]],
      ['a mixed answer where only the AAAA is private', [PUBLIC[0], { address: '::ffff:7f00:1', family: 6 }]],
      [
        'a mixed answer where only the A is private',
        [
          { address: '10.0.0.1', family: 4 },
          { address: '2606:4700:4700::1111', family: 6 },
        ],
      ],
    ])('rejects a hostname whose resolver returns %s', async (_label, addresses) => {
      h.lookup.mockResolvedValue(addresses)
      expect((await post('https://rebind.example.com/')).status).toBe(400)
      expect(h.requests).toHaveLength(0)
    })

    it.each([
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::]/',
      'http://[fe90::1]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[2002:7f00:1::]/',
      'http://[100::1]/',
      'http://100.64.0.1/',
    ])('rejects the literal %s before any DNS lookup', async (url) => {
      expect((await post(url)).status).toBe(400)
      expect(h.lookup).not.toHaveBeenCalled()
      expect(h.requests).toHaveLength(0)
    })

    it('allows public IPv4 and IPv6 answers and pins the connection to the IPv4 one', async () => {
      h.lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }, PUBLIC[0]])
      h.replies.push(html('<meta property="og:image" content="https://cdn.example.com/p.png">'))
      const res = await post('https://dual.example.com/')
      expect((await res.json()).ogImage).toBe('https://cdn.example.com/p.png')
      const options = h.requests[0] as { lookup: (...a: unknown[]) => void }
      const cb = vi.fn()
      options.lookup('dual.example.com', {}, cb)
      expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    })

    it('allows a public IPv6-only answer', async () => {
      h.lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }])
      h.replies.push(html(''))
      expect((await post('https://v6.example.com/')).status).toBe(200)
    })

    it('re-validates a redirect hop whose host resolves to a mapped private address', async () => {
      h.replies.push({ status: 302, headers: { location: 'https://internal-alias.example.com/' } })
      h.lookup.mockImplementation(async (host: string) =>
        host === 'internal-alias.example.com' ? [{ address: '::ffff:7f00:1', family: 6 }] : PUBLIC
      )
      expect((await (await post('https://example.com/')).json()).ogImage).toBeNull()
      expect(h.requests).toHaveLength(1)
    })

    it('does not follow a redirect to a bracketed IPv6 loopback literal', async () => {
      h.replies.push({ status: 302, headers: { location: 'http://[::ffff:7f00:1]/' } })
      expect((await (await post('https://example.com/')).json()).ogImage).toBeNull()
      expect(h.requests).toHaveLength(1)
    })

    it('follows a redirect to a public host, re-validating it', async () => {
      h.replies.push({ status: 302, headers: { location: 'https://www.example.com/final' } })
      h.replies.push(html('<meta property="og:image" content="/x.png">'))
      const body = await (await post('https://example.com/')).json()
      expect(body.ogImage).toBe('https://www.example.com/x.png')
      expect(h.lookup.mock.calls.map((c) => c[0])).toContain('www.example.com')
    })

    it('does not follow a redirect to a private address', async () => {
      h.replies.push({ status: 302, headers: { location: 'http://169.254.169.254/latest' } })
      const body = await (await post('https://example.com/')).json()
      expect(body.ogImage).toBeNull()
      expect(h.requests).toHaveLength(1)
    })

    it('does not follow a redirect to a non-http protocol', async () => {
      h.replies.push({ status: 301, headers: { location: 'file:///etc/passwd' } })
      expect((await (await post('https://example.com/')).json()).ogImage).toBeNull()
      expect(h.requests).toHaveLength(1)
    })

    it('gives up after 3 redirects', async () => {
      for (let i = 0; i < 6; i++) h.replies.push({ status: 302, headers: { location: `https://example.com/${i}` } })
      const body = await (await post('https://example.com/')).json()
      expect(body.ogImage).toBeNull()
      expect(h.requests).toHaveLength(4)
    })
  })
})
