/**
 * Tests for app/api/checkout/credits/route.ts — validates the trust-boundary clamp on the
 * quantity of AI credit packs requested (the extension relays a UI selector value).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockCreateCreditPackCheckoutSession = vi.fn().mockResolvedValue('https://checkout.stripe.com/s1')

vi.mock('@/lib/stripe', () => ({
  createCreditPackCheckoutSession: mockCreateCreditPackCheckoutSession,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@example.com' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: 'cus_1' } }),
    }),
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
  // rule of /api/checkout does not apply here: a subscriber buys credits like anyone else.
  it('starts a credit-pack checkout without consulting the subscriptions table', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    const client = await createClient()
    const { POST } = await import('@/app/api/checkout/credits/route')

    const res = await POST(makeRequest({ quantity: 100 }))

    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://checkout.stripe.com/s1')
    expect(mockCreateCreditPackCheckoutSession).toHaveBeenCalledTimes(1)
    expect(client.from).toHaveBeenCalledWith('profiles')
    expect(client.from).not.toHaveBeenCalledWith('subscriptions')
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
