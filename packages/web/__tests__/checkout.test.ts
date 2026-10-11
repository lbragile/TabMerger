/**
 * Tests for POST /api/checkout (app/api/checkout/route.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared'
import { ALREADY_SUBSCRIBED_ERROR } from '@/lib/checkoutErrors'

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

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
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
      new NextRequest('http://localhost/api/checkout', { method: 'POST', body: '{"tier": "pro"' })
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

  it('reuses an existing stripe_customer_id when present', async () => {
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: 'cus_existing' } })
    const { POST } = await import('@/app/api/checkout/route')

    await POST(makeRequest({ tier: 'pro', interval: 'yearly' }))
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_existing' })
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
      expect(await res.json()).toEqual({ error: 'already_subscribed' })
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled()
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
