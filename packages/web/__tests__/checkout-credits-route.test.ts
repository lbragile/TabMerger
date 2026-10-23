/**
 * Tests for app/api/checkout/credits/route.ts — validates the trust-boundary clamp on the
 * quantity of AI credit packs requested (the extension relays a UI selector value).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AI_ERROR_CODES } from '@tabmerger/shared'

const mockCreateCreditPackCheckoutSession = vi.fn().mockResolvedValue('https://checkout.stripe.com/s1')

vi.mock('@/lib/stripe', () => ({
  createCreditPackCheckoutSession: mockCreateCreditPackCheckoutSession,
}))

/** subscriptions: `.select('tier, ai_mode').eq('user_id', …).maybeSingle()` */
const mockSubscriptionRow = vi.fn()
const mockFrom = vi.fn((table: string) => {
  if (table === 'subscriptions') {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      maybeSingle: mockSubscriptionRow,
    }
    return chain
  }
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: 'cus_1' } }),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } }) },
    from: (table: string) => mockFrom(table),
  }),
}))

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/checkout/credits', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/checkout/credits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'false')
    mockSubscriptionRow.mockResolvedValue({ data: { tier: 'pro_ai', ai_mode: 'managed' }, error: null })
  })

  it('defaults to quantity 50 when body is empty', async () => {
    const { POST } = await import('@/app/api/checkout/credits/route')
    await POST(makeRequest({}))
    expect(mockCreateCreditPackCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 50 })
    )
  })

  it('passes through a valid in-range quantity', async () => {
    const { POST } = await import('@/app/api/checkout/credits/route')
    await POST(makeRequest({ quantity: 150 }))
    expect(mockCreateCreditPackCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 150 })
    )
  })

  it('clamps to quantity 50 when quantity is out of range (0, 49, 501, non-integer, negative)', async () => {
    const { POST } = await import('@/app/api/checkout/credits/route')

    for (const bad of [0, 49, 501, 1.5, -1, 'abc']) {
      mockCreateCreditPackCheckoutSession.mockClear()
      await POST(makeRequest({ quantity: bad }))
      expect(mockCreateCreditPackCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 50 })
      )
    }
  })

  // Credit packs are one-time purchases on top of a plan, so the one-subscription-per-account
  // rule of /api/checkout does not apply here: a managed Pro AI subscriber buys credits on top.
  it('starts a credit-pack checkout for a managed Pro AI subscriber', async () => {
    const { POST } = await import('@/app/api/checkout/credits/route')

    const res = await POST(makeRequest({ quantity: 100 }))

    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://checkout.stripe.com/s1')
    expect(mockCreateCreditPackCheckoutSession).toHaveBeenCalledTimes(1)
    expect(mockFrom).toHaveBeenCalledWith('profiles')
  })

  // Own-key (BYOK) Pro AI spends no TabMerger credits, so a pack would buy nothing.
  it('answers 409 credits_not_applicable to a Pro AI subscriber on their own key, before any Stripe call', async () => {
    mockSubscriptionRow.mockResolvedValue({ data: { tier: 'pro_ai', ai_mode: 'byok' }, error: null })
    const { POST } = await import('@/app/api/checkout/credits/route')

    const res = await POST(makeRequest({ quantity: 100 }))

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: AI_ERROR_CODES.creditsNotApplicable })
    expect(mockCreateCreditPackCheckoutSession).not.toHaveBeenCalled()
  })

  it('does not refuse an account without a row, or a tier other than pro_ai', async () => {
    const { POST } = await import('@/app/api/checkout/credits/route')
    for (const data of [null, { tier: 'free', ai_mode: 'byok' }, { tier: 'pro', ai_mode: 'managed' }]) {
      mockSubscriptionRow.mockResolvedValue({ data, error: null })
      expect((await POST(makeRequest({}))).status).toBe(200)
    }
    expect(mockCreateCreditPackCheckoutSession).toHaveBeenCalledTimes(3)
  })

  it('answers 500 without a Stripe call when the plan cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSubscriptionRow.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } })
    const { POST } = await import('@/app/api/checkout/credits/route')

    const res = await POST(makeRequest({}))

    expect(res.status).toBe(500)
    expect(mockCreateCreditPackCheckoutSession).not.toHaveBeenCalled()
  })

  // Packs are only spent by managed Pro AI, so launching the own-key option alone doesn't sell them.
  it('returns 503 ai_disabled when only the own-key flag is on, before any Stripe call', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', '')
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'true')
    const { POST } = await import('@/app/api/checkout/credits/route')

    const res = await POST(makeRequest({ quantity: 100 }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('ai_disabled')
    expect(mockCreateCreditPackCheckoutSession).not.toHaveBeenCalled()
  })

  it('returns 503 ai_disabled when the AI flag is off, before any Stripe call', async () => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'false')
    const { POST } = await import('@/app/api/checkout/credits/route')

    const res = await POST(makeRequest({ quantity: 100 }))
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toBe('ai_disabled')
    expect(mockCreateCreditPackCheckoutSession).not.toHaveBeenCalled()
  })
})
