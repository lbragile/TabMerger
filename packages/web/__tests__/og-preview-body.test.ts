/**
 * POST /api/og-preview reads its `{ url }` body as JSON whatever the content type: the extension
 * sends `text/plain` (a CORS simple request, no preflight per hover), older builds and the share
 * page `application/json`. Same cap for both. Only paths that never reach the network are
 * exercised here (the fetch itself is covered through the pure parsers in og-preview-route.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { OG_PREVIEW_MAX_BODY_BYTES, POST, readPreviewRequestUrl } from '@/app/api/og-preview/route'

function req(body: string, contentType: string | null, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/og-preview', {
    method: 'POST',
    headers: { ...(contentType ? { 'content-type': contentType } : {}), ...headers },
    body,
  })
}

describe('readPreviewRequestUrl', () => {
  it.each(['text/plain', 'text/plain;charset=UTF-8', 'application/json', null])(
    'reads the url from a JSON body sent as %s',
    async (contentType) => {
      expect(await readPreviewRequestUrl(req(JSON.stringify({ url: 'https://example.com/a' }), contentType))).toEqual({
        ok: true,
        url: 'https://example.com/a',
      })
    }
  )

  it.each([
    ['invalid JSON', '{"url": "https://exa'],
    ['a JSON array', '[1]'],
    ['JSON null', 'null'],
    ['a body without url', '{"href":"https://example.com"}'],
    ['an empty body', ''],
  ])('gives an undefined url for %s', async (_label, body) => {
    expect(await readPreviewRequestUrl(req(body, 'text/plain'))).toEqual({ ok: true, url: undefined })
  })

  it.each(['text/plain', 'application/json'])('refuses a %s body declared over the cap', async (contentType) => {
    const result = await readPreviewRequestUrl(
      req('{"url":"https://example.com"}', contentType, { 'content-length': String(OG_PREVIEW_MAX_BODY_BYTES + 1) })
    )
    expect(result).toEqual({ ok: false, status: 413 })
  })

  it.each(['text/plain', 'application/json'])('refuses a %s body that is over the cap', async (contentType) => {
    const body = JSON.stringify({ url: `https://example.com/${'a'.repeat(OG_PREVIEW_MAX_BODY_BYTES)}` })
    expect(await readPreviewRequestUrl(req(body, contentType))).toEqual({ ok: false, status: 413 })
  })
})

describe('POST /api/og-preview body handling', () => {
  const empty = { ogImage: null, description: null }

  it.each(['text/plain', 'application/json'])('answers 400 for invalid JSON sent as %s', async (contentType) => {
    const res = await POST(req('{"url": "https://exa', contentType))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual(empty)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['text/plain', 'application/json'])('answers 400 for a non-string url sent as %s', async (contentType) => {
    const res = await POST(req(JSON.stringify({ url: 42 }), contentType))
    expect(res.status).toBe(400)
  })

  it.each(['text/plain', 'application/json'])(
    'applies the same URL validation to %s (a blocked address never leaves the server)',
    async (contentType) => {
      for (const url of ['ftp://example.com/', 'http://127.0.0.1/', 'http://[::1]/', 'not a url']) {
        const res = await POST(req(JSON.stringify({ url }), contentType))
        expect(res.status).toBe(400)
        expect(await res.json()).toEqual(empty)
      }
    }
  )

  it.each(['text/plain', 'application/json'])('answers 413 for an oversized %s body', async (contentType) => {
    const res = await POST(
      req('{"url":"https://example.com"}', contentType, { 'content-length': String(OG_PREVIEW_MAX_BODY_BYTES + 1) })
    )
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual(empty)
  })
})
