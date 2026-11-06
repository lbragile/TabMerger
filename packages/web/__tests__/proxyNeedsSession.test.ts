/**
 * proxy.ts only creates the Supabase client and calls `auth.getUser()` (a network round trip to
 * Supabase Auth) for the paths that read the cookie session on the server (`needsSession`). Every
 * other page and route is passed straight to locale routing, keeping the consent-region cookie and
 * the extension CORS headers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const createServerClient = vi.fn(() => ({ auth: { getUser } }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...(args as [])),
}))

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, init)
}

async function loadProxy() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'anon')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.resetModules()
  return import('@/proxy')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  getUser.mockReset()
  createServerClient.mockClear()
})

describe('needsSession', () => {
  it.each([
    '/dashboard',
    '/dashboard/anything',
    '/account',
    '/account/ai-usage',
    '/es/dashboard',
    '/he/account',
    '/auth',
    '/auth/sign-in',
    '/auth/sign-up',
    '/auth/set-password',
    '/api/auth/callback',
    '/api/auth/sign-out',
    '/api/billing/cancel-subscription',
    '/api/billing/keep-current-plan',
    '/api/billing/resume-subscription',
    '/api/billing/switch-plan',
    '/api/billing/switch-interval',
    '/api/billing-portal',
    '/api/checkout',
    '/api/checkout/credits',
    '/api/sessions/123',
    '/api/plan',
  ])('is true for %s (reads the cookie session on the server)', async (path) => {
    const { needsSession } = await loadProxy()
    expect(needsSession(path)).toBe(true)
  })

  it.each([
    '/',
    '/pricing',
    '/de',
    '/fr/pricing',
    '/features',
    '/faq',
    '/privacy',
    '/terms',
    '/changelog',
    '/contact',
    '/beta',
    '/uninstalled',
    '/share/demo',
    '/share/abc123',
    '/es/faq',
    '/pricing/extra',
    '/authx',
    '/api/track',
    '/api/contact',
    '/api/og-preview',
    '/api/health',
    '/api/portal',
    '/api/ai/group-tabs',
    '/api/ai/byok/verify',
    '/api/webhooks/stripe',
    '/api/cron/web-heartbeat',
    '/api/uninstall-feedback',
    '/api/checkoutx',
    '/api/sessionsx',
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/sentry-test',
    '/no-such-page',
  ])('is false for %s (never reads the cookie session)', async (path) => {
    const { needsSession } = await loadProxy()
    expect(needsSession(path)).toBe(false)
  })

  it('matches the protected prefixes the same way as the redirect (startsWith)', async () => {
    const { isProtectedPath, needsSession } = await loadProxy()
    expect(isProtectedPath('/dashboard-old')).toBe(true)
    expect(needsSession('/dashboard-old')).toBe(true)
    expect(isProtectedPath('/pricing')).toBe(false)
  })
})

describe('proxy — session check only where needed', () => {
  it.each(['/', '/pricing', '/faq', '/features', '/es/privacy', '/share/abc123', '/api/track', '/api/ai/group-tabs'])(
    'serves %s without creating a Supabase client',
    async (path) => {
      const { proxy } = await loadProxy()
      const res = await proxy(req(path))
      expect(createServerClient).not.toHaveBeenCalled()
      expect(getUser).not.toHaveBeenCalled()
      expect(res.headers.get('location')).toBeNull()
    }
  )

  it('still sets the consent-region cookie on a public page it skips', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/faq'))
    expect(res.cookies.get('tm_consent_region')?.value).toBe('optin')
  })

  it('still rewrites a skipped public page through next-intl', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/faq'))
    expect(new URL(res.headers.get('x-middleware-rewrite')!).pathname).toBe('/en/faq')
  })

  it('still adds the extension CORS headers to a skipped API route', async () => {
    const { proxy } = await loadProxy()
    const res = await proxy(req('/api/track', { method: 'POST', headers: { origin: 'chrome-extension://abcdefghijklmnop' } }))
    expect(res.headers.get('access-control-allow-origin')).toBe('chrome-extension://abcdefghijklmnop')
    expect(createServerClient).not.toHaveBeenCalled()
  })

  it('refreshes the session and redirects a signed-out visitor away from a protected page', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    const res = await proxy(req('/es/account'))
    expect(getUser).toHaveBeenCalledTimes(1)
    const location = new URL(res.headers.get('location')!)
    expect(location.pathname).toBe('/auth/sign-in')
    expect(location.searchParams.get('redirectTo')).toBe('/es/account')
  })

  it('refreshes the session on an auth page and on the plan route, not on the pricing page', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { proxy } = await loadProxy()
    await proxy(req('/pricing'))
    await proxy(req('/'))
    expect(getUser).not.toHaveBeenCalled()
    await proxy(req('/auth/sign-in'))
    await proxy(req('/api/plan?pendingChange=1'))
    expect(getUser).toHaveBeenCalledTimes(2)
  })

  it('refreshes the session on a cookie-session API route', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { proxy } = await loadProxy()
    await proxy(req('/api/checkout', { method: 'POST' }))
    expect(getUser).toHaveBeenCalledTimes(1)
  })
})
