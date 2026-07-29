/**
 * Tests for POST /api/checkout (app/api/checkout/route.ts)
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockSingle = vi.fn()
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
    mockCreateClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      }),
    })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } } })
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: null } })
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
})
