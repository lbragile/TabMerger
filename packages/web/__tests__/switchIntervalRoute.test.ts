/**
 * Tests for POST /api/billing/switch-interval (app/api/billing/switch-interval/route.ts):
 * moving a paid plan between monthly and yearly billing through the Billing Portal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockSubscription = vi.fn()
const mockProfile = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.order = () => q
      q.limit = () => q
      q.maybeSingle = mockSubscription
      return q
    },
  })),
  createServiceRoleClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: mockProfile }) }) }),
  })),
}))

const mockCreateSession = vi.fn()
vi.mock('@/lib/stripe', async () => {
  class IntervalSwitchError extends Error {
    constructor(readonly reason: string) {
      super(reason)
    }
  }
  return { createIntervalSwitchSession: mockCreateSession, IntervalSwitchError }
})

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/billing/switch-interval', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

async function post(body: unknown) {
  const { POST } = await import('@/app/api/billing/switch-interval/route')
  return POST(request(body))
}

describe('POST /api/billing/switch-interval', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
    vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_y')
    vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
    vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSubscription.mockResolvedValue({ data: { tier: 'pro', status: 'active' } })
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: 'cus_1' } })
    mockCreateSession.mockResolvedValue('https://billing.stripe.com/p/session/test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects a missing or unknown interval with 400', async () => {
    for (const body of [{}, { interval: 'weekly' }, 'not json']) {
      const res = await post(body)
      expect(res.status).toBe(400)
    }
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('returns 401 when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await post({ interval: 'yearly' })
    expect(res.status).toBe(401)
  })

  it('returns 403 for a free account, and for a paid tier whose subscription is not entitled', async () => {
    mockSubscription.mockResolvedValue({ data: { tier: 'free', status: 'active' } })
    expect((await post({ interval: 'yearly' })).status).toBe(403)

    mockSubscription.mockResolvedValue({ data: { tier: 'pro', status: 'incomplete' } })
    expect((await post({ interval: 'yearly' })).status).toBe(403)

    mockSubscription.mockResolvedValue({ data: null })
    expect((await post({ interval: 'yearly' })).status).toBe(403)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('moves Pro to its own yearly price, returning to the account page', async () => {
    const res = await post({ interval: 'yearly' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/p/session/test' })
    expect(mockCreateSession).toHaveBeenCalledWith({
      customerId: 'cus_1',
      targetPriceId: 'price_pro_y',
      planPriceIds: ['price_pro_m', 'price_pro_y'],
      returnUrl: 'https://tabmerger.app/account',
    })
  })

  it('keeps Pro AI on Pro AI prices (only the interval can change, never the plan)', async () => {
    mockSubscription.mockResolvedValue({ data: { tier: 'pro_ai', status: 'trialing' } })
    await post({ interval: 'monthly' })
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetPriceId: 'price_ai_m', planPriceIds: ['price_ai_m', 'price_ai_y'] })
    )
  })

  it('returns 503 when the target price is not configured', async () => {
    vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', '')
    const res = await post({ interval: 'yearly' })
    expect(res.status).toBe(503)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('returns 400 when the user has no Stripe customer', async () => {
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: null } })
    expect((await post({ interval: 'yearly' })).status).toBe(400)
  })

  it('maps "already on that price" to 409 and "no subscription in Stripe" to 403', async () => {
    const { IntervalSwitchError } = await import('@/lib/stripe')
    mockCreateSession.mockRejectedValueOnce(new IntervalSwitchError('already_on_price'))
    expect((await post({ interval: 'yearly' })).status).toBe(409)

    const again = await import('@/lib/stripe')
    mockCreateSession.mockRejectedValueOnce(new again.IntervalSwitchError('no_subscription'))
    expect((await post({ interval: 'yearly' })).status).toBe(403)
  })

  it('maps a pending scheduled switch to 409 with a message the page shows as-is', async () => {
    const { IntervalSwitchError } = await import('@/lib/stripe')
    mockCreateSession.mockRejectedValueOnce(new IntervalSwitchError('already_scheduled'))
    const res = await post({ interval: 'monthly' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already scheduled for the end of this term/)
  })

  it('returns 500 on an unexpected Stripe error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateSession.mockRejectedValueOnce(new Error('stripe down'))
    expect((await post({ interval: 'yearly' })).status).toBe(500)
  })
})
