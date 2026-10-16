/**
 * The site moved off `*.vercel.app`. The old hosts stay up (old extension builds
 * call their APIs), but their HTML pages 308 to the canonical custom domain.
 * /api/* and /firefox-beta/* must never redirect: a CORS preflight can't follow
 * one, and Firefox's beta update check needs a direct response.
 *
 * Runs with Supabase env unset, like proxyCors.test.ts: the redirect happens
 * before the Supabase client is built.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const CHROME_EXT = 'chrome-extension://ogfmehaahkdfdfggcaabepknidpdgnbb'

function req(
  url: string,
  { method = 'GET', host, origin }: { method?: string; host?: string; origin?: string } = {},
) {
  const headers: Record<string, string> = { host: host ?? new URL(url).host }
  if (origin) headers.origin = origin
  return new NextRequest(url, { method, headers })
}

async function loadProxy() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  return import('@/proxy')
}

describe('proxy — legacy host redirect', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it.each([
    ['https://tabmerger.vercel.app/pricing?x=1', 'https://tabmerger.com/pricing?x=1'],
    ['https://tabmerger-preview.vercel.app/pricing?x=1', 'https://preview.tabmerger.com/pricing?x=1'],
    ['https://tabmerger.vercel.app/', 'https://tabmerger.com/'],
    ['https://tabmerger.vercel.app/share/abc123XYZ', 'https://tabmerger.com/share/abc123XYZ'],
  ])('308s %s to %s', async (from, to) => {
    const { proxy } = await loadProxy()
    const res = await proxy(req(from))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe(to)
  })

  it.each(['TabMerger.Vercel.APP', 'tabmerger.vercel.app:443'])(
    'matches the host variant %s',
    async (host) => {
      const { proxy } = await loadProxy()
      const res = await proxy(req('https://tabmerger.vercel.app/features', { host }))
      expect(res.status).toBe(308)
      expect(res.headers.get('location')).toBe('https://tabmerger.com/features')
    },
  )

  it('falls back to the URL hostname when there is no host header', async () => {
    const { legacyHostRedirect } = await loadProxy()
    const request = new NextRequest('https://tabmerger.vercel.app/pricing')
    request.headers.delete('host')
    expect(legacyHostRedirect(request)?.href).toBe('https://tabmerger.com/pricing')
  })

  it('keeps the method with 308 for a non-GET page request', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('https://tabmerger.vercel.app/contact', { method: 'POST' }))
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://tabmerger.com/contact')
  })

  it('cannot be steered off the fixed origin by a protocol-relative path', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('https://tabmerger.vercel.app//evil.com/x'))
    expect(res.status).toBe(308)
    const location = res.headers.get('location')!
    expect(location).toBe('https://tabmerger.com//evil.com/x')
    expect(new URL(location).origin).toBe('https://tabmerger.com')
  })

  it.each([
    'https://tabmerger.vercel.app/api/track',
    'https://tabmerger.vercel.app/api',
    'https://tabmerger.vercel.app/api/auth/callback?code=abc',
    'https://tabmerger.vercel.app/firefox-beta/updates.json',
    'https://tabmerger.vercel.app/firefox-beta',
    'https://tabmerger-preview.vercel.app/api/track',
  ])('never redirects %s', async (url) => {
    const { proxy, legacyHostRedirect } = await loadProxy()
    expect(legacyHostRedirect(req(url))).toBeNull()
    const res = await proxy(req(url, { method: 'POST' }))
    expect(res.status).not.toBe(308)
    expect(res.headers.get('location')).toBeNull()
  })

  it('still redirects a path that only starts with "api"', async () => {
    const { legacyHostRedirect } = await loadProxy()
    expect(legacyHostRedirect(req('https://tabmerger.vercel.app/apix'))?.href).toBe(
      'https://tabmerger.com/apix',
    )
  })

  it('answers an extension preflight on the legacy host with 204 and CORS headers', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(
      req('https://tabmerger.vercel.app/api/track', { method: 'OPTIONS', origin: CHROME_EXT }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(CHROME_EXT)
    expect(res.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/)
  })

  it.each([
    'https://tabmerger.com/pricing',
    'https://preview.tabmerger.com/pricing',
    'http://localhost:3000/pricing',
    'https://tabmerger-abc123-team.vercel.app/pricing',
    'https://tabmerger.vercel.app.evil.com/pricing',
  ])('does not redirect %s', async (url) => {
    const { proxy } = await loadProxy()
    const res = await proxy(req(url))
    expect(res.status).not.toBe(308)
    expect(res.headers.get('location')).toBeNull()
  })
})
