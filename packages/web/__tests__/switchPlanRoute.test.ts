/**
 * Tests for POST /api/billing/switch-plan (app/api/billing/switch-plan/route.ts) and the Pro AI
 * option in POST /api/billing/switch-interval: moving a paid plan to another Price of the same
 * tier (interval, and for Pro AI TabMerger's key ↔ own key) through the Billing Portal.
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
  class PlanSwitchError extends Error {
    constructor(readonly reason: string) {
      super(reason)
    }
  }
  return { createPlanSwitchSession: mockCreateSession, PlanSwitchError }
})

const ALL_PRO_AI_PRICES = ['price_ai_m', 'price_ai_y', 'price_byok_m', 'price_byok_y']

async function post(path: 'switch-plan' | 'switch-interval', body: unknown) {
  const { POST } =
    path === 'switch-plan'
      ? await import('@/app/api/billing/switch-plan/route')
      : await import('@/app/api/billing/switch-interval/route')
  return POST(
    new NextRequest(`http://localhost/api/billing/${path}`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

describe('POST /api/billing/switch-plan', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'false')
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
    vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_y')
    vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
    vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_ai_m', ai_mode: 'managed' },
    })
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: 'cus_1' } })
    mockCreateSession.mockResolvedValue({ kind: 'portal', url: 'https://billing.stripe.com/p/session/test' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('moves managed Pro AI to the own-key price at the same interval', async () => {
    const res = await post('switch-plan', { aiMode: 'byok' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/p/session/test' })
    expect(mockCreateSession).toHaveBeenCalledWith({
      customerId: 'cus_1',
      targetPriceId: 'price_byok_m',
      planPriceIds: ALL_PRO_AI_PRICES,
      returnUrl: 'https://tabmerger.app/account',
    })
  })

  it('moves own-key Pro AI back to managed, keeping the yearly interval', async () => {
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'past_due', stripe_price_id: 'price_byok_y', ai_mode: 'byok' },
    })
    await post('switch-plan', { aiMode: 'managed' })
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetPriceId: 'price_ai_y', planPriceIds: ALL_PRO_AI_PRICES })
    )
  })

  it('changes interval and option together when both are sent', async () => {
    await post('switch-plan', { interval: 'yearly', aiMode: 'byok' })
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ targetPriceId: 'price_byok_y' }))
  })

  it('falls back to the stored ai_mode when the price is not one this environment knows', async () => {
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_legacy', ai_mode: 'byok' },
    })
    await post('switch-plan', { interval: 'monthly' })
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ targetPriceId: 'price_byok_m' }))
  })

  it('needs the interval when the current price is unknown', async () => {
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_legacy', ai_mode: 'managed' },
    })
    expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(400)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it.each([
    ['an empty body', {}],
    ['not JSON', 'not json'],
    ['an unknown aiMode', { aiMode: 'free-ai' }],
    ['an unknown interval', { interval: 'weekly' }],
    ['a valid aiMode with a bad interval', { aiMode: 'byok', interval: 'daily' }],
  ])('rejects %s with 400', async (_label, body) => {
    expect((await post('switch-plan', body)).status).toBe(400)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('refuses an AI option for Pro (403): only Pro AI has it', async () => {
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m', ai_mode: 'managed' },
    })
    expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(403)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('refuses a free or not-entitled account (403)', async () => {
    mockSubscription.mockResolvedValue({ data: { tier: 'pro_ai', status: 'canceled' } })
    expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(403)
    mockSubscription.mockResolvedValue({ data: null })
    expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(403)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('answers 503 ai_disabled while neither AI option is on, before any Stripe call', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    for (const aiMode of ['byok', 'managed']) {
      const res = await post('switch-plan', { aiMode })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'ai_disabled' })
    }
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  describe('own key launched before managed AI (only NEXT_PUBLIC_AI_BYOK_ENABLED)', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', '')
      vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    })

    it('allows a switch to the own-key option', async () => {
      expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(200)
      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ targetPriceId: 'price_byok_m' }))
    })

    it('refuses a switch to managed with 503 ai_disabled', async () => {
      mockSubscription.mockResolvedValue({
        data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_byok_m', ai_mode: 'byok' },
      })
      const res = await post('switch-plan', { aiMode: 'managed' })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'ai_disabled' })
      expect(mockCreateSession).not.toHaveBeenCalled()
    })

    it('an interval-only switch-plan keeps the current option and is gated by it', async () => {
      // On managed now: staying on managed needs the managed flag.
      expect((await post('switch-plan', { interval: 'yearly' })).status).toBe(503)

      mockSubscription.mockResolvedValue({
        data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_byok_m', ai_mode: 'byok' },
      })
      expect((await post('switch-plan', { interval: 'yearly' })).status).toBe(200)
      expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ targetPriceId: 'price_byok_y' }))
    })

    it('Pro interval switches never depend on the AI flags', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', '')
      mockSubscription.mockResolvedValue({
        data: { tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m', ai_mode: 'managed' },
      })
      expect((await post('switch-plan', { interval: 'yearly' })).status).toBe(200)
    })
  })

  it('answers 503 when the own-key price is not configured', async () => {
    vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', '')
    expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(503)
    expect(mockCreateSession).not.toHaveBeenCalled()
  })

  it('says "already on that plan" for a switch to the current option', async () => {
    const { PlanSwitchError } = await import('@/lib/stripe')
    mockCreateSession.mockRejectedValueOnce(new PlanSwitchError('already_on_price'))
    const res = await post('switch-plan', { aiMode: 'managed' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("You're already on that plan.")
  })

  it('returns 401 when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    expect((await post('switch-plan', { aiMode: 'byok' })).status).toBe(401)
  })

  describe('tier changes and the refund policy', () => {
    it('moves Pro AI to Pro at the same interval, looking the subscription up among the Pro AI prices', async () => {
      mockCreateSession.mockResolvedValue({ kind: 'scheduled', effectiveAt: 1_800_000_000 })
      const res = await post('switch-plan', { tier: 'pro' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        applied: 'end_of_period',
        effectiveAt: new Date(1_800_000_000 * 1000).toISOString(),
        url: 'https://tabmerger.app/account',
      })
      expect(mockCreateSession).toHaveBeenCalledWith({
        customerId: 'cus_1',
        targetPriceId: 'price_pro_m',
        planPriceIds: ALL_PRO_AI_PRICES,
        returnUrl: 'https://tabmerger.app/account',
      })
    })

    it('a downgrade to Pro needs no AI flag', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
      mockCreateSession.mockResolvedValue({ kind: 'scheduled', effectiveAt: 1_800_000_000 })
      expect((await post('switch-plan', { tier: 'pro' })).status).toBe(200)
    })

    it('moves Pro to managed Pro AI by default, among the Pro prices', async () => {
      mockSubscription.mockResolvedValue({
        data: { tier: 'pro', status: 'active', stripe_price_id: 'price_pro_y', ai_mode: 'managed' },
      })
      const res = await post('switch-plan', { tier: 'proAi' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/p/session/test' })
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ targetPriceId: 'price_ai_y', planPriceIds: ['price_pro_m', 'price_pro_y'] })
      )
    })

    it('refuses Pro → managed Pro AI with 503 ai_disabled while managed AI is off', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
      vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
      mockSubscription.mockResolvedValue({
        data: { tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m', ai_mode: 'managed' },
      })
      const res = await post('switch-plan', { tier: 'proAi' })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'ai_disabled' })
      expect(mockCreateSession).not.toHaveBeenCalled()
    })

    it('refuses an AI option together with tier Pro (403)', async () => {
      expect((await post('switch-plan', { tier: 'pro', aiMode: 'byok' })).status).toBe(403)
      expect(mockCreateSession).not.toHaveBeenCalled()
    })

    it.each([['the database spelling', { tier: 'pro_ai' }], ['free', { tier: 'free' }], ['a number', { tier: 1 }]])(
      'rejects tier %s with 400',
      async (_label, body) => {
        expect((await post('switch-plan', body)).status).toBe(400)
        expect(mockCreateSession).not.toHaveBeenCalled()
      }
    )

    it('Pro → Pro AI on the own key (managed off, own key on sale) opens the portal confirm page', async () => {
      vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
      vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
      mockSubscription.mockResolvedValue({
        data: { tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m', ai_mode: 'managed' },
      })
      const res = await post('switch-plan', { tier: 'proAi', interval: 'monthly', aiMode: 'byok' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/p/session/test' })
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({ targetPriceId: 'price_byok_m', planPriceIds: ['price_pro_m', 'price_pro_y'] })
      )
    })

    it('answers 503 price_unavailable when the target price is not configured, and logs which', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', '')
      mockSubscription.mockResolvedValue({
        data: { tier: 'pro', status: 'active', stripe_price_id: 'price_pro_m', ai_mode: 'managed' },
      })
      const res = await post('switch-plan', { tier: 'proAi', aiMode: 'byok' })
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'Price not configured', code: 'price_unavailable' })
      expect(errorSpy).toHaveBeenCalledWith('Plan switch: no price configured for proAi monthly byok')
      expect(mockCreateSession).not.toHaveBeenCalled()
      errorSpy.mockRestore()
    })

    it('answers 503 price_unavailable when Stripe has the target price archived', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { PlanSwitchError } = await import('@/lib/stripe')
      mockCreateSession.mockRejectedValueOnce(new PlanSwitchError('price_unavailable'))
      const res = await post('switch-plan', { aiMode: 'byok' })
      expect(res.status).toBe(503)
      expect((await res.json()).code).toBe('price_unavailable')
      errorSpy.mockRestore()
    })

    it('a Stripe failure is 500 switch_failed, logged as one line without the error object', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockCreateSession.mockRejectedValueOnce(
        Object.assign(new Error('No such price'), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
          param: 'price',
          statusCode: 400,
          requestId: 'req_123',
          raw: { headers: { authorization: 'secret' } },
        })
      )
      const res = await post('switch-plan', { aiMode: 'byok' })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to start the plan change', code: 'switch_failed' })
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy.mock.calls[0]).toEqual([
        'Plan switch to price_byok_m failed: StripeInvalidRequestError, code resource_missing, param price, status 400, request req_123: No such price',
      ])
      errorSpy.mockRestore()
    })

    it('answers 409 when a downgrade is already scheduled', async () => {
      const { PlanSwitchError } = await import('@/lib/stripe')
      mockCreateSession.mockRejectedValueOnce(new PlanSwitchError('already_scheduled'))
      const res = await post('switch-plan', { tier: 'pro' })
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({
        error: 'A billing change is already scheduled for the end of this term.',
        code: 'already_scheduled',
      })
    })

    it('answers 409 when the plan is set to cancel', async () => {
      const { PlanSwitchError } = await import('@/lib/stripe')
      mockCreateSession.mockRejectedValueOnce(new PlanSwitchError('cancel_scheduled'))
      const res = await post('switch-plan', { tier: 'pro' })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toMatch(/set to end/)
      expect(body.code).toBe('cancel_scheduled')
    })
  })
})

describe('POST /api/billing/switch-interval keeps the Pro AI option', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
    vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: 'cus_1' } })
    mockCreateSession.mockResolvedValue({ kind: 'portal', url: 'https://billing.stripe.com/p/session/test' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('moves an own-key subscriber to the own-key price of the other interval, never to managed', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_byok_m', ai_mode: 'byok' },
    })
    const res = await post('switch-interval', { interval: 'yearly' })
    expect(res.status).toBe(200)
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetPriceId: 'price_byok_y', planPriceIds: ALL_PRO_AI_PRICES })
    )
  })

  it('is gated by the flag of the option the subscriber stays on', async () => {
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_ai_m', ai_mode: 'managed' },
    })
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    expect((await post('switch-interval', { interval: 'yearly' })).status).toBe(200)

    // Only the own-key option is on: a managed subscriber can't switch interval, an own-key one can.
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    const refused = await post('switch-interval', { interval: 'yearly' })
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ error: 'ai_disabled' })

    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_byok_m', ai_mode: 'byok' },
    })
    expect((await post('switch-interval', { interval: 'yearly' })).status).toBe(200)
    expect(mockCreateSession).toHaveBeenCalledTimes(2)
  })
})
