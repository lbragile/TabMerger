/**
 * The consent-region cookie in proxy.ts: how a request's region is worked out (Vercel geo-IP
 * headers, or `CONSENT_REGION_OVERRIDE` off production), and that every response for a page gets
 * `tm_consent_region` (pass-throughs, next-intl rewrites and redirects, sign-in redirects) while
 * API routes and files never do. Pages are static, so this cookie is the only way the browser
 * learns its region; a response without it falls back to opt-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const getUser = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser } }),
}))

const COOKIE = 'tm_consent_region'

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url.startsWith('http') ? url : `http://localhost:3000${url}`, { headers })
}

const US = { 'x-vercel-ip-country': 'US' }
const DE = { 'x-vercel-ip-country': 'DE' }

/** The `tm_consent_region` Set-Cookie line on a response, or null. */
function regionSetCookie(res: Response): string | null {
  const all = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ?? '').split(/,(?=\s*\w+=)/)
  return all.find((line) => line.trim().startsWith(`${COOKIE}=`))?.trim() ?? null
}

const regionOf = (res: Response) => regionSetCookie(res)?.match(/^tm_consent_region=([^;]*)/)?.[1] ?? null

async function loadProxy(configured = true) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured ? 'https://example.supabase.co' : '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', configured ? 'anon' : '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.resetModules()
  return import('@/proxy')
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', '')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', '')
  vi.stubEnv('CONSENT_REGION_OVERRIDE', '')
  getUser.mockResolvedValue({ data: { user: null } })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  getUser.mockReset()
})

describe('rendersPage', () => {
  it.each(['/', '/pricing', '/de/pricing', '/share/abc', '/dashboard', '/auth/sign-in', '/sentry-test', '/no-such-page', '/apix'])(
    'is true for the page path %s',
    async (path) => {
      const { rendersPage } = await loadProxy(false)
      expect(rendersPage(path)).toBe(true)
    }
  )

  it.each([
    '/api',
    '/api/checkout',
    '/api/auth/callback',
    '/firefox-beta/updates.json',
    '/sentry-tunnel',
    '/_next/static/chunk.js',
    '/_vercel/insights/script.js',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/favicon.ico',
    '/opengraph-image.png',
    '/logo.png',
  ])('is false for %s (no page, no banner)', async (path) => {
    const { rendersPage } = await loadProxy(false)
    expect(rendersPage(path)).toBe(false)
  })
})

describe('consentRegionForRequest', () => {
  it('reads the Vercel geo-IP country and subdivision', async () => {
    const { consentRegionForRequest } = await loadProxy(false)
    expect(consentRegionForRequest(req('/', US))).toBe('optout')
    expect(consentRegionForRequest(req('/', DE))).toBe('optin')
    expect(consentRegionForRequest(req('/', { 'x-vercel-ip-country': 'CA', 'x-vercel-ip-country-region': 'QC' }))).toBe('optin')
    expect(consentRegionForRequest(req('/', { 'x-vercel-ip-country': 'CA', 'x-vercel-ip-country-region': 'ON' }))).toBe('optout')
  })

  it('is opt-in without geo headers (localhost) or with garbage in them', async () => {
    const { consentRegionForRequest } = await loadProxy(false)
    expect(consentRegionForRequest(req('/'))).toBe('optin')
    expect(consentRegionForRequest(req('/', { 'x-vercel-ip-country': 'us' }))).toBe('optin')
    expect(consentRegionForRequest(req('/', { 'x-vercel-ip-country': 'XX' }))).toBe('optin')
  })

  it('honours CONSENT_REGION_OVERRIDE off production, over the headers', async () => {
    const { consentRegionForRequest } = await loadProxy(false)
    vi.stubEnv('CONSENT_REGION_OVERRIDE', 'US')
    expect(consentRegionForRequest(req('/'))).toBe('optout')
    expect(consentRegionForRequest(req('/', DE))).toBe('optout')
    vi.stubEnv('CONSENT_REGION_OVERRIDE', 'CA-QC')
    expect(consentRegionForRequest(req('/', US))).toBe('optin')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('CONSENT_REGION_OVERRIDE', 'US')
    expect(consentRegionForRequest(req('/', DE))).toBe('optout')
  })

  it('ignores CONSENT_REGION_OVERRIDE on the production deployment', async () => {
    const { consentRegionForRequest } = await loadProxy(false)
    vi.stubEnv('CONSENT_REGION_OVERRIDE', 'US')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(consentRegionForRequest(req('/'))).toBe('optin')
    expect(consentRegionForRequest(req('/', DE))).toBe('optin')
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(consentRegionForRequest(req('/', DE))).toBe('optin')
  })

  it('falls back to the headers when the override is malformed', async () => {
    const { consentRegionForRequest } = await loadProxy(false)
    for (const bad of ['us', 'USA', 'optout', 'US;DE']) {
      vi.stubEnv('CONSENT_REGION_OVERRIDE', bad)
      expect(consentRegionForRequest(req('/', US))).toBe('optout')
      expect(consentRegionForRequest(req('/', DE))).toBe('optin')
    }
  })
})

describe('withConsentRegion', () => {
  it('sets a day-long, site-wide, Lax cookie readable by script when it is missing', async () => {
    const { withConsentRegion } = await loadProxy(false)
    const res = withConsentRegion(req('/pricing', US), NextResponse.next())
    const line = regionSetCookie(res)!
    expect(line).toMatch(/^tm_consent_region=optout;/)
    expect(line).toMatch(/Max-Age=86400/i)
    expect(line).toMatch(/Path=\/(;|$)/i)
    expect(line).toMatch(/SameSite=lax/i)
    expect(line).not.toMatch(/HttpOnly/i)
    expect(line).not.toMatch(/Secure/i)
  })

  it('marks the cookie Secure on https', async () => {
    const { withConsentRegion } = await loadProxy(false)
    const res = withConsentRegion(req('https://tabmerger.com/pricing', US), NextResponse.next())
    expect(regionSetCookie(res)).toMatch(/;\s*Secure/i)
  })

  it('replaces a cookie that holds a different (or forged) region', async () => {
    const { withConsentRegion } = await loadProxy(false)
    expect(regionOf(withConsentRegion(req('/', { ...DE, cookie: `${COOKIE}=optout` }), NextResponse.next()))).toBe('optin')
    expect(regionOf(withConsentRegion(req('/', { ...US, cookie: `${COOKIE}=junk` }), NextResponse.next()))).toBe('optout')
  })

  it('leaves the response alone when the cookie already matches', async () => {
    const { withConsentRegion } = await loadProxy(false)
    const res = withConsentRegion(req('/', { ...US, cookie: `${COOKIE}=optout` }), NextResponse.next())
    expect(regionSetCookie(res)).toBeNull()
  })

  it.each(['/api/checkout', '/_next/static/x.js', '/robots.txt', '/logo.png'])('never sets it on %s', async (path) => {
    const { withConsentRegion } = await loadProxy(false)
    expect(regionSetCookie(withConsentRegion(req(path, US), NextResponse.next()))).toBeNull()
  })
})

describe('proxy() responses carry the region cookie', () => {
  it('on a next-intl rewrite of an English page', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/pricing', US))
    expect(res.headers.get('x-middleware-rewrite')).toMatch(/\/en\/pricing$/)
    expect(regionOf(res)).toBe('optout')
  })

  it('on a prefixed locale page', async () => {
    const { proxy } = await loadProxy()
    expect(regionOf(await proxy(req('/fr/pricing', DE)))).toBe('optin')
  })

  it("on next-intl's /en/… redirect and its NEXT_LOCALE redirect", async () => {
    const { proxy } = await loadProxy()
    const toUnprefixed = await proxy(req('/en/pricing', US))
    expect(toUnprefixed.status).toBe(307)
    expect(regionOf(toUnprefixed)).toBe('optout')
    const toSaved = await proxy(req('/pricing', { ...US, cookie: 'NEXT_LOCALE=fr' }))
    expect(new URL(toSaved.headers.get('location')!).pathname).toBe('/fr/pricing')
    expect(regionOf(toSaved)).toBe('optout')
  })

  it('on the non-localized /auth/* pass-through', async () => {
    const { proxy } = await loadProxy()
    expect(regionOf(await proxy(req('/auth/sign-in', US)))).toBe('optout')
  })

  it('on the sign-in redirect from a protected page', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/dashboard', US))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/auth/sign-in')
    expect(regionOf(res)).toBe('optout')
  })

  it('on the redirect that sends a signed-in visitor from sign-in to the dashboard', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/auth/sign-in', DE))
    expect(new URL(res.headers.get('location')!).pathname).toBe('/dashboard')
    expect(regionOf(res)).toBe('optin')
  })

  it('when Supabase is not configured (the fail-open pass-through)', async () => {
    const { proxy } = await loadProxy(false)
    expect(regionOf(await proxy(req('/pricing', US)))).toBe('optout')
  })

  it('defaults to opt-in on localhost, which has no geo headers', async () => {
    const { proxy } = await loadProxy()
    expect(regionOf(await proxy(req('/')))).toBe('optin')
  })

  it('follows CONSENT_REGION_OVERRIDE through the real proxy', async () => {
    vi.stubEnv('CONSENT_REGION_OVERRIDE', 'US')
    const { proxy } = await loadProxy()
    expect(regionOf(await proxy(req('/')))).toBe('optout')
  })

  it.each(['/api/checkout', '/api/auth/callback', '/robots.txt', '/opengraph-image.png'])(
    'but never on %s',
    async (path) => {
      const { proxy } = await loadProxy()
      expect(regionSetCookie(await proxy(req(path, US)))).toBeNull()
    }
  )

})
