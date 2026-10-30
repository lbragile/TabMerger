/**
 * lib/billingRequestGuard.ts's same-origin check, and both guards on every billing POST route that
 * acts on Stripe: a cookie route refuses a post from another origin (403 `forbidden_origin`) before
 * reading the session, and every route, the extension's Bearer `/api/portal` included, answers 429
 * `rate_limited` with `Retry-After` past the per-user billing limit, before any database read or
 * Stripe call. Supabase, Stripe and the limiter are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, type NextResponse } from 'next/server'
import { SAME_ORIGIN_HEADERS } from './helpers/billingRequest'

const { mockTakeRateLimit, mockCookieGetUser, mockBearerGetUser, mockFrom, stripeCalls } = vi.hoisted(() => ({
  mockTakeRateLimit: vi.fn(),
  mockCookieGetUser: vi.fn(),
  mockBearerGetUser: vi.fn(),
  mockFrom: vi.fn(),
  // Every Stripe call the routes can make; none may run when a guard refuses.
  stripeCalls: {
    createCheckoutSession: vi.fn(),
    createCreditPackCheckoutSession: vi.fn(),
    createBillingPortalSession: vi.fn(),
    createCancelSubscriptionSession: vi.fn(),
    keepCurrentPlan: vi.fn(),
    createPlanSwitchSession: vi.fn(),
  },
}))
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  takeRateLimit: mockTakeRateLimit,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockCookieGetUser }, from: mockFrom })),
  createServiceRoleClient: vi.fn(async () => ({ auth: { getUser: mockBearerGetUser }, from: mockFrom })),
}))

vi.mock('@/lib/stripe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe')>()),
  ...stripeCalls,
}))
vi.mock('@/lib/checkoutGuard', () => ({ checkStripeBeforeCheckout: vi.fn() }))

import { rejectCrossOriginPost } from '@/lib/billingRequestGuard'

const ORIGIN = 'https://tabmerger.com'
const post = (path: string, headers: Record<string, string> = {}, body: unknown = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })

describe('rejectCrossOriginPost', () => {
  it.each([
    ['Sec-Fetch-Site: same-origin', { 'sec-fetch-site': 'same-origin' }],
    ['same-origin even with an Origin header', { 'sec-fetch-site': 'same-origin', origin: ORIGIN }],
    ['no Sec-Fetch-Site, Origin equal to this origin', { origin: ORIGIN }],
  ])('accepts %s', (_name, headers) => {
    expect(rejectCrossOriginPost(post('/api/checkout', headers))).toBeNull()
  })

  it.each([
    ['Sec-Fetch-Site: same-site (another subdomain, e.g. a preview)', { 'sec-fetch-site': 'same-site', origin: 'https://preview.tabmerger.com' }],
    ['Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }],
    ['Sec-Fetch-Site: none', { 'sec-fetch-site': 'none' }],
    ['same-site even when Origin claims this origin', { 'sec-fetch-site': 'same-site', origin: ORIGIN }],
    ['no Sec-Fetch-Site, Origin of a subdomain', { origin: 'https://preview.tabmerger.com' }],
    ['no Sec-Fetch-Site, Origin on another scheme', { origin: 'http://tabmerger.com' }],
    ['no Sec-Fetch-Site, Origin on another port', { origin: 'https://tabmerger.com:8443' }],
    ['no Sec-Fetch-Site, Origin "null" (sandboxed page)', { origin: 'null' }],
    ['neither header', {}],
  ])('refuses %s with 403 forbidden_origin', async (_name, headers) => {
    const res = rejectCrossOriginPost(post('/api/checkout', headers))
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'forbidden_origin', code: 'forbidden_origin' })
  })
})

type Route = { name: string; path: string; load: () => Promise<{ POST: (req: NextRequest) => Promise<NextResponse> }>; body?: unknown }

const COOKIE_ROUTES: Route[] = [
  { name: 'checkout', path: '/api/checkout', load: () => import('@/app/api/checkout/route'), body: { tier: 'pro', interval: 'monthly' } },
  { name: 'credit pack checkout', path: '/api/checkout/credits', load: () => import('@/app/api/checkout/credits/route') },
  { name: 'switch plan', path: '/api/billing/switch-plan', load: () => import('@/app/api/billing/switch-plan/route'), body: { tier: 'proAi' } },
  { name: 'switch interval', path: '/api/billing/switch-interval', load: () => import('@/app/api/billing/switch-interval/route'), body: { interval: 'yearly' } },
  { name: 'keep current plan', path: '/api/billing/keep-current-plan', load: () => import('@/app/api/billing/keep-current-plan/route') },
  { name: 'cancel subscription', path: '/api/billing/cancel-subscription', load: () => import('@/app/api/billing/cancel-subscription/route') },
  { name: 'billing portal', path: '/api/billing-portal', load: () => import('@/app/api/billing-portal/route') },
]

describe('billing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    mockCookieGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'x' } } })
    mockBearerGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockTakeRateLimit.mockResolvedValue({ kind: 'limited', retryAfterSeconds: 37 })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const expectNothingRan = () => {
    expect(mockFrom).not.toHaveBeenCalled()
    for (const [name, fn] of Object.entries(stripeCalls)) expect(fn, name).not.toHaveBeenCalled()
  }

  describe.each(COOKIE_ROUTES)('$name ($path)', ({ path, load, body }) => {
    it('403 forbidden_origin for a same-site post, before the session is read', async () => {
      const { POST } = await load()
      const res = await POST(post(path, { 'sec-fetch-site': 'same-site', origin: 'https://preview.tabmerger.com' }, body))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin', code: 'forbidden_origin' })
      expect(mockCookieGetUser).not.toHaveBeenCalled()
      expect(mockTakeRateLimit).not.toHaveBeenCalled()
      expectNothingRan()
    })

    it('429 rate_limited with Retry-After past the billing limit, keyed by the user, before any read or Stripe call', async () => {
      const { POST } = await load()
      const res = await POST(post(path, SAME_ORIGIN_HEADERS, body))
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('37')
      expect(await res.json()).toEqual({ error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 37 })
      expect(mockTakeRateLimit).toHaveBeenCalledTimes(1)
      expect(mockTakeRateLimit.mock.calls[0][0]).toMatchObject({ name: 'billing' })
      expect(mockTakeRateLimit.mock.calls[0][1]).toBe('user-1')
      expectNothingRan()
    })

    it('401 for a signed-out caller without counting a hit', async () => {
      mockCookieGetUser.mockResolvedValue({ data: { user: null } })
      const { POST } = await load()
      const res = await POST(post(path, SAME_ORIGIN_HEADERS, body))
      expect(res.status).toBe(401)
      expect(mockTakeRateLimit).not.toHaveBeenCalled()
    })
  })

  describe("the extension's /api/portal (Bearer token)", () => {
    const bearer = (headers: Record<string, string> = {}) =>
      post('/api/portal', { authorization: 'Bearer token-1', ...headers })

    it('429 rate_limited past the billing limit, keyed by the user', async () => {
      const { POST } = await import('@/app/api/portal/route')
      const res = await POST(bearer())
      expect(res.status).toBe(429)
      expect(res.headers.get('Retry-After')).toBe('37')
      expect(mockTakeRateLimit.mock.calls[0][1]).toBe('user-1')
      expectNothingRan()
    })

    it('has no origin check: the extension posts from its own origin', async () => {
      mockTakeRateLimit.mockResolvedValue({ kind: 'allowed' })
      mockFrom.mockReturnValue({
        select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_customer_id: 'cus_1' } }) }) }),
      })
      stripeCalls.createBillingPortalSession.mockResolvedValue('https://billing.stripe.com/p/session/x')
      const { POST } = await import('@/app/api/portal/route')
      const res = await POST(bearer({ 'sec-fetch-site': 'cross-site', origin: 'chrome-extension://abc' }))
      expect(res.status).toBe(200)
    })
  })
})
