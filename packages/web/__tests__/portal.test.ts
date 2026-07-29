/**
 * Tests for POST /api/portal (app/api/portal/route.ts)
 * Bearer-token variant of the billing portal, used by the extension.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockSingle = vi.fn()
const mockCreateServiceRoleClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: mockCreateServiceRoleClient,
}))

const mockCreateBillingPortalSession = vi.fn()

vi.mock('@/lib/stripe', () => ({
  createBillingPortalSession: mockCreateBillingPortalSession,
}))

function makeRequest(token?: string) {
  return new NextRequest('http://localhost/api/portal', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

describe('POST /api/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateServiceRoleClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      }),
    })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: 'cus_test123' } })
    mockCreateBillingPortalSession.mockResolvedValue('https://billing.stripe.com/session/test')
  })

  it('returns 401 when no Authorization header is present', async () => {
    const { POST } = await import('@/app/api/portal/route')

    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(mockCreateServiceRoleClient).not.toHaveBeenCalled()
  })

  it('returns 401 when the token is invalid', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('bad token') })
    const { POST } = await import('@/app/api/portal/route')

    const res = await POST(makeRequest('bad-token'))
    expect(res.status).toBe(401)
  })

  it('returns 404 when the user has no stripe_customer_id', async () => {
    mockSingle.mockResolvedValue({ data: null })
    const { POST } = await import('@/app/api/portal/route')

    const res = await POST(makeRequest('good-token'))
    expect(res.status).toBe(404)
  })

  it('returns a portal URL for an authenticated user with a billing account', async () => {
    const { POST } = await import('@/app/api/portal/route')

    const res = await POST(makeRequest('good-token'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('stripe.com')
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_test123' })
    )
  })

  it('returns 500 when Stripe throws', async () => {
    mockCreateBillingPortalSession.mockRejectedValue(new Error('stripe down'))
    const { POST } = await import('@/app/api/portal/route')

    const res = await POST(makeRequest('good-token'))
    expect(res.status).toBe(500)
  })
})
