/**
 * The extension calls ten /api routes. All but og-preview send a JSON body or a
 * Bearer token, so the browser preflights them — and nothing answered the
 * preflight, so every one was blocked by CORS. proxy.ts now handles it centrally.
 *
 * Runs with Supabase env unset: CORS must work independently of auth config.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const CHROME_DEV = 'chrome-extension://ogfmehaahkdfdfggcaabepknidpdgnbb'
const FIREFOX = 'moz-extension://2d3f7a1c-9b8e-4c6d-a5f0-1e2b3c4d5e6f'

function req(path: string, { method = 'POST', origin }: { method?: string; origin?: string } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: origin ? { origin } : {},
  })
}

async function loadProxy() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return import('@/proxy')
}

describe('proxy — extension CORS', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('answers a preflight from the extension with 204 and the right headers', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { method: 'OPTIONS', origin: CHROME_DEV }))
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CHROME_DEV)
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    // Must be named explicitly — a `*` wildcard does not cover Authorization.
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/)
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Content-Type/)
    expect(res.headers.get('Vary')).toBe('Origin')
  })

  it.each(['/api/track', '/api/ai/group-tabs', '/api/ai/tab-summary', '/api/portal'])(
    'covers %s, not just analytics',
    async (path) => {
      const { proxy } = await loadProxy()
      const res = await proxy(req(path, { method: 'OPTIONS', origin: CHROME_DEV }))
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CHROME_DEV)
    },
  )

  it('adds CORS headers to the actual (post-preflight) request too', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { origin: CHROME_DEV }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CHROME_DEV)
  })

  it('allows Firefox, whose extension origin is a random per-install UUID', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { method: 'OPTIONS', origin: FIREFOX }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(FIREFOX)
  })

  it('never allows credentials — another extension must not ride this site\'s cookies', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { method: 'OPTIONS', origin: CHROME_DEV }))
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  it('does not grant CORS to ordinary websites', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { method: 'OPTIONS', origin: 'https://evil.example' }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it.each([
    'chrome-extension://abc/../x',
    'chrome-extension://abc.evil.example',
    'https://chrome-extension.example',
  ])('rejects look-alike origin %s', async (origin) => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { method: 'OPTIONS', origin }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('leaves non-API routes alone even for an extension origin', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/pricing', { method: 'GET', origin: CHROME_DEV }))
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
