/**
 * Tests for POST /api/checkout (app/api/checkout/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared'
import { ALREADY_SUBSCRIBED_ERROR } from '@/lib/checkoutErrors'
import { SAME_ORIGIN_HEADERS } from './helpers/billingRequest'
// The per-user billing limit is tested in rateLimit.test.ts and billingRequestGuard.test.ts; here
// it always allows, so these tests need no limiter RPC on their Supabase mock.
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  takeRateLimit: vi.fn(async () => ({ kind: 'allowed' })),
}))

const mockGetUser = vi.fn()
/** profiles: `.select('stripe_customer_id').eq('id', …).single()` */
const mockSingle = vi.fn()
/** subscriptions: `.select('tier, status').eq('user_id', …).maybeSingle()` */
const mockSubscription = vi.fn()
const mockSubscriptionEq = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

const mockCreateCheckoutSession = vi.fn()
const mockGetStripePriceId = vi.fn()

vi.mock('@/lib/stripe', () => ({
  createCheckoutSession: mockCreateCheckoutSession,
  getStripePriceId: mockGetStripePriceId,
}))

/** The Stripe check for an existing customer (lib/checkoutGuard.ts, tested in checkoutStripeGuard.test.ts). */
const mockCheckStripe = vi.fn()
vi.mock('@/lib/checkoutGuard', () => ({ checkStripeBeforeCheckout: mockCheckStripe }))

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/checkout', {
    method: 'POST',
    headers: { ...SAME_ORIGIN_HEADERS, ...headers },
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'false')
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn((table: string) => {
        if (table === 'subscriptions') {
          const chain = {
            select: vi.fn(() => chain),
            eq: vi.fn((column: string, value: string) => {
              mockSubscriptionEq(column, value)
              return chain
            }),
            maybeSingle: mockSubscription,
          }
          return chain
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: mockSingle,
        }
      }),
    })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } } })
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: null } })
    // Every account has a row from signup: free until a purchase.
    mockSubscription.mockResolvedValue({ data: { tier: 'free', status: 'active' }, error: null })
    mockGetStripePriceId.mockReturnValue('price_pro_monthly')
    mockCreateCheckoutSession.mockResolvedValue('https://checkout.stripe.com/session/test')
    mockCheckStripe.mockResolvedValue({ kind: 'clear' })
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an invalid tier', async () => {
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'bogus', interval: 'monthly' }))
    expect(res.status).toBe(400)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns 400 for a body that is not JSON', async () => {
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(
      new NextRequest('http://localhost/api/checkout', { method: 'POST', headers: SAME_ORIGIN_HEADERS, body: '{"tier": "pro"' })
    )
    expect(res.status).toBe(400)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['a string', 'pro'],
    ['a number', 1],
    ['an array', ['pro', 'monthly']],
  ])('returns 400 for a JSON body that is %s', async (_label, body) => {
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest(body))
    expect(res.status).toBe(400)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid interval', async () => {
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'weekly' }))
    expect(res.status).toBe(400)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns 500 when the price ID is not configured', async () => {
    mockGetStripePriceId.mockReturnValue(undefined)
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'proAi', interval: 'yearly' }))
    expect(res.status).toBe(500)
  })

  it('creates a checkout session and returns the URL for a valid tier/interval', async () => {
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://checkout.stripe.com/session/test')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', priceId: 'price_pro_monthly' })
    )
  })

  it('sends a cancel_url carrying the checkout_canceled marker, and stamps tier/interval for the expired webhook', async () => {
    const { POST } = await import('@/app/api/checkout/route')

    await POST(makeRequest({ tier: 'pro', interval: 'yearly' }))
    const args = mockCreateCheckoutSession.mock.calls[0][0]
    expect(new URL(args.cancelUrl).pathname).toBe('/pricing')
    expect(new URL(args.cancelUrl).search).toBe('?checkout=canceled&tier=pro&interval=yearly')
    expect(args).toEqual(expect.objectContaining({ tier: 'pro', interval: 'yearly' }))
  })

  describe('own key launched before managed AI (only NEXT_PUBLIC_AI_BYOK_ENABLED)', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', '')
      vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    })

    it('sells the own-key option', async () => {
      const { POST } = await import('@/app/api/checkout/route')
      const res = await POST(makeRequest({ tier: 'proAi', interval: 'monthly', aiMode: 'byok' }))
      expect(res.status).toBe(200)
      expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['managed explicitly', { tier: 'proAi', interval: 'yearly', aiMode: 'managed' }],
      ['managed by default', { tier: 'proAi', interval: 'monthly' }],
    ])('refuses Pro AI %s with 503 ai_disabled and no Stripe call', async (_label, body) => {
      const { POST } = await import('@/app/api/checkout/route')
      const res = await POST(makeRequest(body))
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'ai_disabled' })
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    })

    it('Pro is unaffected by the AI flags', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', '')
      const { POST } = await import('@/app/api/checkout/route')
      expect((await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))).status).toBe(200)
    })
  })

  it('refuses the own-key option too while neither AI flag is on', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    const { POST } = await import('@/app/api/checkout/route')
    const res = await POST(makeRequest({ tier: 'proAi', interval: 'monthly', aiMode: 'byok' }))
    expect(res.status).toBe(503)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  describe('Pro AI option (aiMode)', () => {
    it('defaults Pro AI to managed: the managed price, ai_mode on the session for analytics', async () => {
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest({ tier: 'proAi', interval: 'monthly' }))

      expect(res.status).toBe(200)
      expect(mockGetStripePriceId).toHaveBeenCalledWith('proAi', 'monthly', 'managed')
      expect(mockCreateCheckoutSession.mock.calls[0][0]).toMatchObject({ tier: 'proAi', aiMode: 'managed' })
    })

    it('sells the own-key option at its own price, and marks it on the cancel_url', async () => {
      mockGetStripePriceId.mockReturnValue('price_byok_yearly')
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest({ tier: 'proAi', interval: 'yearly', aiMode: 'byok' }))

      expect(res.status).toBe(200)
      expect(mockGetStripePriceId).toHaveBeenCalledWith('proAi', 'yearly', 'byok')
      const args = mockCreateCheckoutSession.mock.calls[0][0]
      expect(args).toMatchObject({ priceId: 'price_byok_yearly', tier: 'proAi', interval: 'yearly', aiMode: 'byok' })
      expect(new URL(args.cancelUrl).searchParams.get('aiMode')).toBe('byok')
    })

    it('stamps no aiMode on a Pro session', async () => {
      const { POST } = await import('@/app/api/checkout/route')
      await POST(makeRequest({ tier: 'pro', interval: 'monthly', aiMode: 'managed' }))
      expect(mockCreateCheckoutSession.mock.calls[0][0]).not.toHaveProperty('aiMode')
    })

    it.each([
      ['an unknown value', { tier: 'proAi', interval: 'monthly', aiMode: 'free-ai' }],
      ['a non-string', { tier: 'proAi', interval: 'monthly', aiMode: 1 }],
      ['null', { tier: 'proAi', interval: 'monthly', aiMode: null }],
      ['byok with Pro', { tier: 'pro', interval: 'monthly', aiMode: 'byok' }],
    ])('rejects %s with 400 and no Stripe call', async (_label, body) => {
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest(body))

      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Invalid aiMode' })
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    })
  })

  describe('cancel_url locale', () => {
    async function cancelUrlFor(headers: Record<string, string>) {
      const { POST } = await import('@/app/api/checkout/route')
      await POST(makeRequest({ tier: 'pro', interval: 'monthly' }, headers))
      return new URL(mockCreateCheckoutSession.mock.lastCall![0].cancelUrl)
    }

    it('keeps the locale of the page the click came from (Referer)', async () => {
      const url = await cancelUrlFor({ referer: 'https://tabmerger.app/fr/pricing' })
      expect(url.pathname).toBe('/fr/pricing')
      expect(url.searchParams.get('checkout')).toBe('canceled')
    })

    it('falls back to the NEXT_LOCALE cookie, then to the unprefixed default', async () => {
      expect((await cancelUrlFor({ cookie: 'NEXT_LOCALE=ja' })).pathname).toBe('/ja/pricing')
      expect((await cancelUrlFor({})).pathname).toBe('/pricing')
    })

    it("ignores a locale that is not one of this build's, from either source", async () => {
      const url = await cancelUrlFor({
        referer: 'https://evil.example/..%2f..%2fevil/pricing',
        cookie: 'NEXT_LOCALE=<script>',
      })
      expect(url.origin).toBe('https://tabmerger.app')
      expect(url.pathname).toBe('/pricing')
    })

    it('an /en referer stays unprefixed (default locale)', async () => {
      expect((await cancelUrlFor({ referer: 'https://tabmerger.app/en/pricing' })).pathname).toBe('/pricing')
    })
  })


  it('reuses an existing stripe_customer_id when present', async () => {
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: 'cus_existing' } })
    const { POST } = await import('@/app/api/checkout/route')

    await POST(makeRequest({ tier: 'pro', interval: 'yearly' }))
    expect(mockCheckStripe).toHaveBeenCalledWith('user-1', 'cus_existing')
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_existing' })
    )
  })

  it('asks Stripe nothing when the profile has no Stripe customer yet', async () => {
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))

    expect(res.status).toBe(200)
    expect(mockCheckStripe).not.toHaveBeenCalled()
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ customerId: undefined }))
  })

  it.each([
    [{ kind: 'live', recorded: true }, 409, { error: 'already_subscribed', recorded: true }],
    [{ kind: 'live', recorded: false }, 409, { error: 'already_subscribed', recorded: false }],
    [{ kind: 'open' }, 409, { error: 'pay_or_resume' }],
    [{ kind: 'check_failed' }, 503, { error: 'billing_check_failed' }],
  ])('turns the Stripe check %j into %i and creates no session', async (guard, status, body) => {
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: 'cus_existing' } })
    mockCheckStripe.mockResolvedValue(guard)
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))

    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(body)
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  it('drops a customer Stripe does not have, so Checkout makes a new one', async () => {
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: 'cus_gone' } })
    mockCheckStripe.mockResolvedValue({ kind: 'customer_missing' })
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))

    expect(res.status).toBe(200)
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: undefined })
    )
  })

  it('returns 500 when Stripe throws', async () => {
    mockCreateCheckoutSession.mockRejectedValue(new Error('stripe down'))
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))
    expect(res.status).toBe(500)
  })

  it('returns 503 ai_disabled for proAi tier when the AI flag is off, before any Stripe call', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    const { POST } = await import('@/app/api/checkout/route')

    const res = await POST(makeRequest({ tier: 'proAi', interval: 'monthly' }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('ai_disabled')
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
  })

  // An account holds one subscription: checkout starts the first one, the Billing Portal changes it.
  describe('one subscription per account', () => {
    it.each([
      ['pro', 'active'],
      ['pro', 'trialing'],
      ['pro', 'past_due'],
      ['pro_ai', 'active'],
      ['pro_ai', 'trialing'],
      ['pro_ai', 'past_due'],
    ])('returns 409 already_subscribed for a %s / %s row and creates no Stripe session', async (tier, status) => {
      mockSubscription.mockResolvedValue({ data: { tier, status }, error: null })
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest({ tier: 'pro', interval: 'yearly' }))

      expect(res.status).toBe(409)
      // The wire value the pricing card matches on.
      expect(ALREADY_SUBSCRIBED_ERROR).toBe('already_subscribed')
      // `recorded`: the row already shows the plan, so the page refreshes to show it.
      expect(await res.json()).toEqual({ error: 'already_subscribed', recorded: true })
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
      expect(mockCheckStripe).not.toHaveBeenCalled()
    })

    it('the entitled statuses are the shared list, so the rule cannot drift from the rest of the product', async () => {
      const { POST } = await import('@/app/api/checkout/route')

      for (const status of ENTITLED_SUBSCRIPTION_STATUSES) {
        mockSubscription.mockResolvedValue({ data: { tier: 'pro', status }, error: null })
        const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))
        expect(res.status).toBe(409)
      }
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    })

    it('reads the row of the signed-in user', async () => {
      const { POST } = await import('@/app/api/checkout/route')

      await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))

      expect(mockSubscriptionEq).toHaveBeenCalledWith('user_id', 'user-1')
    })

    it('a Pro subscriber choosing Pro AI gets 409 once AI is on, not a second subscription', async () => {
      mockSubscription.mockResolvedValue({ data: { tier: 'pro', status: 'active' }, error: null })
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest({ tier: 'proAi', interval: 'monthly' }))

      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe(ALREADY_SUBSCRIBED_ERROR)
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    })

    it('the AI flag answers first: Pro AI is 503 ai_disabled while AI is off, whatever the plan', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
      mockSubscription.mockResolvedValue({ data: { tier: 'pro', status: 'active' }, error: null })
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest({ tier: 'proAi', interval: 'monthly' }))

      expect(res.status).toBe(503)
      expect((await res.json()).error).toBe('ai_disabled')
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
    })

    it.each([
      ['a free row', { tier: 'free', status: 'active' }],
      ['a canceled row (downgraded to free)', { tier: 'free', status: 'canceled' }],
      ['a paid-tier row whose status is canceled', { tier: 'pro', status: 'canceled' }],
      ['a paid-tier row whose first payment never completed', { tier: 'pro', status: 'incomplete' }],
      ['a free row left past_due', { tier: 'free', status: 'past_due' }],
      ['no row', null],
    ])('starts checkout as before for %s', async (_label, row) => {
      mockSubscription.mockResolvedValue({ data: row, error: null })
      const { POST } = await import('@/app/api/checkout/route')

      const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))

      expect(res.status).toBe(200)
      expect((await res.json()).url).toBe('https://checkout.stripe.com/session/test')
      expect(mockCreateCheckoutSession).toHaveBeenCalledTimes(1)
    })

    it('returns 500 and creates no Stripe session when the plan cannot be read', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSubscription.mockResolvedValue({ data: null, error: { code: 'PGRST000' } })
      const { POST } = await import('@/app/api/checkout/route')

      try {
        const res = await POST(makeRequest({ tier: 'pro', interval: 'monthly' }))

        expect(res.status).toBe(500)
        expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
      }
    })
  })
})
