/**
 * Locale routing in proxy.ts (next-intl, `localePrefix: 'as-needed'`): English keeps today's
 * unprefixed URLs (served internally from `/en/...`), sections outside `app/[locale]/` are never
 * touched, and a locale prefix never gets around the signed-in pages' protection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser } }),
}))

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { headers })
}

/** Where next-intl serves the request from internally, or null when it isn't rewritten. */
const rewrittenTo = (res: Response) => {
  const target = res.headers.get('x-middleware-rewrite')
  return target ? new URL(target).pathname : null
}

async function loadProxy(configured = true) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured ? 'https://example.supabase.co' : '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', configured ? 'anon' : '')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.resetModules()
  return import('@/proxy')
}

describe('proxy — locale routing', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    getUser.mockReset()
  })

  it.each(['/', '/pricing', '/share/abc123', '/dashboard'])('serves English %s at its unprefixed URL', async (path) => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { proxy } = await loadProxy()
    const res = await proxy(req(path))
    expect(res.headers.get('location')).toBeNull()
    expect(rewrittenTo(res)).toBe(path === '/' ? '/en' : `/en${path}`)
  })

  it('redirects a /en/ prefix to the unprefixed URL, keeping the query', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/en/pricing?interval=yearly'))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(
      '/pricing?interval=yearly'
    )
  })

  it('does not set a locale cookie or a Link header while English is the only language', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/pricing', { 'accept-language': 'de-DE,de;q=0.9', 'sec-fetch-dest': 'document' }))
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/NEXT_LOCALE/)
    expect(res.headers.get('link')).toBeNull()
  })

  it.each([
    '/api/checkout',
    '/api/auth/callback',
    '/auth/sign-in',
    '/sentry-test',
    '/sentry-tunnel',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/opengraph-image.png',
    '/icon.png',
  ])('leaves %s alone (outside app/[locale])', async (path) => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req(path))
    expect(rewrittenTo(res)).toBeNull()
    expect(res.headers.get('location')).toBeNull()
  })

  it('drops a locale header the client sent on paths the locale handler skips', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/auth/sign-up', { 'x-next-intl-locale': 'xx' }))
    // NextResponse.next({ request: { headers } }) lists the forwarded request headers here.
    expect(res.headers.get('x-middleware-request-x-next-intl-locale')).toBeNull()
  })

  it('protects the signed-in pages behind a locale prefix too', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/en-XA/dashboard'))
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/sign-in')
    expect(location.searchParams.get('redirectTo')).toBe('/en-XA/dashboard')
  })

  it('still routes locales when Supabase is not configured (fails open, as before)', async () => {
    const { proxy } = await loadProxy(false)
    const res = await proxy(req('/pricing'))
    expect(rewrittenTo(res)).toBe('/en/pricing')
  })

  it('serves an unknown first segment under the default locale, where the page answers 404', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/xx/pricing'))
    expect(rewrittenTo(res)).toBe('/en/xx/pricing')
  })
})

describe('proxy — path helpers', () => {
  it('knows which paths are localized', async () => {
    const { isLocalizedPath } = await loadProxy(false)
    expect(isLocalizedPath('/')).toBe(true)
    expect(isLocalizedPath('/pricing')).toBe(true)
    expect(isLocalizedPath('/share/abc')).toBe(true)
    expect(isLocalizedPath('/apix')).toBe(true)
    expect(isLocalizedPath('/api')).toBe(false)
    expect(isLocalizedPath('/api/ai/organize')).toBe(false)
    expect(isLocalizedPath('/auth/sign-in')).toBe(false)
    expect(isLocalizedPath('/firefox-beta/updates.json')).toBe(false)
    expect(isLocalizedPath('/logo.png')).toBe(false)
  })

  it('strips a routable locale prefix only', async () => {
    const { stripLocalePrefix } = await loadProxy(false)
    expect(stripLocalePrefix('/en/dashboard')).toBe('/dashboard')
    expect(stripLocalePrefix('/en-XA')).toBe('/')
    expect(stripLocalePrefix('/dashboard')).toBe('/dashboard')
    expect(stripLocalePrefix('/english/dashboard')).toBe('/english/dashboard')
  })
})

describe('proxy — locale detection stays on', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    getUser.mockReset()
  })

  it('is explicitly enabled in the routing config', async () => {
    const { routing } = await import('@/i18n/routing')
    expect(routing.localeDetection).toBe(true)
  })

  it('sends an unprefixed request to the locale saved in the NEXT_LOCALE cookie', async () => {
    // The pseudo-locale is routable in tests; it stands in for any non-default language.
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/pricing', { cookie: 'NEXT_LOCALE=en-XA' }))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en-XA/pricing')
  })
})

describe('proxy — shipped languages', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    getUser.mockReset()
  })

  it("remembers a language other than the browser's in a NEXT_LOCALE cookie that lasts a year", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/fr/pricing', { 'accept-language': 'en-US,en;q=0.9', 'sec-fetch-dest': 'document' }))
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/NEXT_LOCALE=fr;/)
    expect(cookie).toMatch(/Max-Age=31536000/i)
    expect(cookie).toMatch(/Path=\/(;|$)/i)
    expect(cookie).toMatch(/SameSite=lax/i)
  })

  it('serves /fr/pricing from the French segment, without a redirect or an English rewrite', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/fr/pricing'))
    expect(res.headers.get('location')).toBeNull()
    const rewritten = rewrittenTo(res)
    expect(rewritten === null || rewritten === '/fr/pricing').toBe(true)
  })

  it('sends a French browser on an unprefixed page to the French URL', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/pricing', { 'accept-language': 'fr-FR,fr;q=0.9' }))
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/fr/pricing')
  })
})
