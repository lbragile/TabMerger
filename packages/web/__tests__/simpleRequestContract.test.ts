/**
 * Contract between packages: the exact Content-Type the extension sends to the web app
 * (`SIMPLE_JSON_CONTENT_TYPE` in packages/extension/src/lib/simpleRequest.ts) must be accepted by
 * both routes it is used for. The value is read from the extension source, so changing it there
 * without the web routes keeping up fails here.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as track } from '@/app/api/track/route'
import { POST as ogPreview, readPreviewRequestUrl } from '@/app/api/og-preview/route'

const source = readFileSync(path.resolve(__dirname, '../../extension/src/lib/simpleRequest.ts'), 'utf8')
const SIMPLE_JSON_CONTENT_TYPE = /SIMPLE_JSON_CONTENT_TYPE\s*=\s*'([^']+)'/.exec(source)?.[1] ?? ''

const mockFetch = vi.fn().mockResolvedValue({ ok: true })

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockClear()
  vi.stubEnv('GA_EXTENSION_MEASUREMENT_ID', 'G-TEST123')
  vi.stubEnv('GA_EXTENSION_API_SECRET', 'test-secret')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const post = (url: string, body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'content-type': SIMPLE_JSON_CONTENT_TYPE }, body: JSON.stringify(body) })

describe('extension simple-request content type', () => {
  it('is read from the extension source and is a CORS-safelisted type', () => {
    expect(SIMPLE_JSON_CONTENT_TYPE).toBe('text/plain;charset=UTF-8')
    expect(SIMPLE_JSON_CONTENT_TYPE.split(';')[0]).toMatch(/^(text\/plain|multipart\/form-data|application\/x-www-form-urlencoded)$/)
  })

  it('is accepted by /api/track: the event is forwarded', async () => {
    const res = await track(
      post('http://localhost/api/track', { event: 'group_created', params: { count: 1 }, client_id: 'abc-123' })
    )
    expect(res.status).toBe(204)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).events[0].name).toBe('group_created')
  })

  it('is accepted by /api/og-preview: the body is read as JSON and the url reaches the handler', async () => {
    const read = await readPreviewRequestUrl(post('http://localhost/api/og-preview', { url: 'https://example.com/a' }))
    expect(read).toEqual({ ok: true, url: 'https://example.com/a' })
    // The full handler parses it too: a non-string url is refused as a url (400), not as a body.
    const res = await ogPreview(post('http://localhost/api/og-preview', { url: 7 }))
    expect(res.status).toBe(400)
  })
})
