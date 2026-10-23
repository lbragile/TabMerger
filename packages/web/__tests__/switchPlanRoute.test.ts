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
    mockCreateSession.mockResolvedValue('https://billing.stripe.com/p/session/test')
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

  it('answers 503 ai_disabled to an AI option while AI is off, before any Stripe call', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    const res = await post('switch-plan', { aiMode: 'byok' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_disabled' })
    expect(mockCreateSession).not.toHaveBeenCalled()
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
    mockCreateSession.mockResolvedValue('https://billing.stripe.com/p/session/test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('moves an own-key subscriber to the own-key price of the other interval, never to managed', async () => {
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_byok_m', ai_mode: 'byok' },
    })
    const res = await post('switch-interval', { interval: 'yearly' })
    expect(res.status).toBe(200)
    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetPriceId: 'price_byok_y', planPriceIds: ALL_PRO_AI_PRICES })
    )
  })

  it('is not gated by the AI flag (it changes no AI option)', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    mockSubscription.mockResolvedValue({
      data: { tier: 'pro_ai', status: 'active', stripe_price_id: 'price_ai_m', ai_mode: 'managed' },
    })
    expect((await post('switch-interval', { interval: 'yearly' })).status).toBe(200)
  })
})
