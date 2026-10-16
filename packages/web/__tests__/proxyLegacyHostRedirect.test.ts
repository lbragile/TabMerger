/**
 * The site moved off `*.vercel.app`. The old hosts stay up (old extension builds
 * call their APIs and sign in there), and only an allow-list of public pages 308s
 * to the canonical custom domain. Everything else — the signed-in app, auth, the
 * API, Firefox beta files and any route not on the list — is served where it was
 * asked for, so the redirect fails closed.
 *
 * Runs with Supabase env unset, like proxyCors.test.ts: the redirect happens
 * before the Supabase client is built.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const CHROME_EXT = 'chrome-extension://ogfmehaahkdfdfggcaabepknidpdgnbb'

const LEGACY_HOSTS: [string, string][] = [
  ['tabmerger.vercel.app', 'https://tabmerger.com'],
  ['tabmerger-preview.vercel.app', 'https://preview.tabmerger.com'],
]

/** Every public page that moves, including ones under `/share/`. */
const ALLOWED_PATHS = [
  '/',
  '/pricing',
  '/features',
  '/faq',
  '/beta',
  '/changelog',
  '/contact',
  '/privacy',
  '/terms',
  '/uninstalled',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/share/abc123XYZ',
  '/share/demo',
]

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

async function expectNotRedirected(url: string, method = 'GET') {
  const { proxy, legacyHostRedirect } = await loadProxy()
  expect(legacyHostRedirect(req(url))).toBeNull()
  const res = await proxy(req(url, { method }))
  expect(res.status).not.toBe(308)
  expect(res.headers.get('location')).toBeNull()
}

describe('proxy — legacy host redirect', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  describe.each(LEGACY_HOSTS)('on %s', (host, targetOrigin) => {
    it.each(ALLOWED_PATHS)('308s %s with its query to the new host', async (path) => {
      const { proxy } = await loadProxy()
      const res = await proxy(req(`https://${host}${path}?utm_source=x&a=1`))
      expect(res.status).toBe(308)
      expect(res.headers.get('location')).toBe(`${targetOrigin}${path}?utm_source=x&a=1`)
    })

    it('308s an allowed path without a query', async () => {
      const { proxy } = await loadProxy()
      const res = await proxy(req(`https://${host}/pricing`))
      expect(res.headers.get('location')).toBe(`${targetOrigin}/pricing`)
    })
  })

  it.each([
    ['/pricing/', 'https://tabmerger.com/pricing'],
    ['/share/abc/', 'https://tabmerger.com/share/abc'],
    ['/?q=1', 'https://tabmerger.com/?q=1'],
    ['/pricing/?q=1', 'https://tabmerger.com/pricing?q=1'],
  ])('drops one trailing slash: %s → %s', async (path, to) => {
    const { legacyHostRedirect } = await loadProxy()
    expect(legacyHostRedirect(req(`https://tabmerger.vercel.app${path}`))?.href).toBe(to)
  })

  it.each([
    '/dashboard',
    '/dashboard/',
    '/dashboard/backups',
    '/account',
    '/account?tab=billing',
    '/auth/sign-in',
    '/auth/sign-in?redirectTo=%2Fdashboard',
    '/auth/sign-up',
    '/auth/callback',
    '/api',
    '/api/track',
    '/api/auth/callback?code=abc',
    '/firefox-beta',
    '/firefox-beta/updates.json',
    '/sentry-test',
  ])('never redirects the signed-in or excluded path %s', async (path) => {
    for (const [host] of LEGACY_HOSTS) await expectNotRedirected(`https://${host}${path}`, 'POST')
  })

  it.each([
    '/pricingx',
    '/pricing.html',
    '/share-evil',
    '/sharex/abc',
    '/featuresfoo',
    '/llms.txt.bak',
    '/Pricing',
    '/pricing//',
    '/some-new-page',
    '/blog/hello',
    '/apix',
  ])('does not redirect the lookalike or unknown path %s', async (path) => {
    await expectNotRedirected(`https://tabmerger.vercel.app${path}`)
  })

  it.each([
    ['//evil.com/x', null],
    ['/%2F%2Fevil.com', null],
    ['/share//evil.com/x', 'https://tabmerger.com/share//evil.com/x'],
    ['/share/%2F%2Fevil.com', 'https://tabmerger.com/share/%2F%2Fevil.com'],
    ['/share/%2f%2fevil.com%2Fx', 'https://tabmerger.com/share/%2f%2fevil.com%2Fx'],
    ['/share/@evil.com', 'https://tabmerger.com/share/@evil.com'],
  ])('keeps the fixed origin for %s', async (path, expected) => {
    const { legacyHostRedirect } = await loadProxy()
    const target = legacyHostRedirect(req(`https://tabmerger.vercel.app${path}`))
    if (expected === null) {
      expect(target).toBeNull()
    } else {
      expect(target?.href).toBe(expected)
      expect(target?.origin).toBe('https://tabmerger.com')
    }
  })

  it.each(['TabMerger.Vercel.APP', 'tabmerger.vercel.app:443', ' tabmerger.vercel.app '])(
    'matches the host variant %j',
    async (host) => {
      const { legacyHostRedirect } = await loadProxy()
      expect(legacyHostRedirect(req('https://tabmerger.vercel.app/features', { host }))?.href).toBe(
        'https://tabmerger.com/features',
      )
    },
  )

  it('handles the proxy end to end for a mixed-case host with a port', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(
      req('https://tabmerger.vercel.app/features', { host: 'TabMerger-Preview.Vercel.App:8443' }),
    )
    expect(res.status).toBe(308)
    expect(res.headers.get('location')).toBe('https://preview.tabmerger.com/features')
  })

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
    'http://localhost:3000/',
    'https://tabmerger-abc123-team.vercel.app/pricing',
    'https://tabmerger.vercel.app.evil.com/pricing',
    'https://evil.tabmerger.vercel.app/pricing',
    'https://vercel.app/pricing',
  ])('does not redirect a non-legacy host: %s', async (url) => {
    await expectNotRedirected(url)
  })

  it('ignores a spoofed non-legacy Host header on a legacy URL', async () => {
    await loadProxy().then(({ legacyHostRedirect }) => {
      expect(
        legacyHostRedirect(req('https://tabmerger.vercel.app/pricing', { host: 'evil.com' })),
      ).toBeNull()
    })
  })
})
