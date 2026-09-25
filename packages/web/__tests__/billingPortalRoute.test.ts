/**
 * Tests for POST /api/billing-portal (app/api/billing-portal/route.ts)
 * Session-cookie variant of the billing portal, used by the pricing page.
 *
 * There was no route-level test here at all, which is how its return URL kept a hand-built
 * `NEXT_PUBLIC_APP_URL + '/dashboard'` after every other Stripe redirect target moved to
 * absoluteUrl(). These tests pin it to the runtime resolver.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockGetUser = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceRoleClient: vi.fn(async () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    }),
  })),
}))

const mockCreateBillingPortalSession = vi.fn()
vi.mock('@/lib/stripe', () => ({
  createBillingPortalSession: mockCreateBillingPortalSession,
}))

const request = () => new NextRequest('http://localhost/api/billing-portal', { method: 'POST' })

describe('POST /api/billing-portal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: 'cus_test123' } })
    mockCreateBillingPortalSession.mockResolvedValue('https://billing.stripe.com/session/test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 401 when signed out', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { POST } = await import('@/app/api/billing-portal/route')
    const res = await POST(request())
    expect(res.status).toBe(401)
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled()
  })

  it('returns 400 when the user has no Stripe customer yet', async () => {
    mockSingle.mockResolvedValue({ data: { stripe_customer_id: null } })
    const { POST } = await import('@/app/api/billing-portal/route')
    const res = await POST(request())
    expect(res.status).toBe(400)
  })

  it('returns to the configured app URL in production', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    const { POST } = await import('@/app/api/billing-portal/route')
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_test123', returnUrl: 'https://tabmerger.app/dashboard' }),
    )
  })

  it('returns to the preview it was opened from, not the configured app URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('VERCEL_URL', 'tabmerger-abc123-lbragiles-projects.vercel.app')
    const { POST } = await import('@/app/api/billing-portal/route')
    await POST(request())
    expect(mockCreateBillingPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({
        returnUrl: 'https://tabmerger-abc123-lbragiles-projects.vercel.app/dashboard',
      }),
    )
  })

  it('never hands Stripe a bare relative path when the app URL is missing', async () => {
    // The old code did `(NEXT_PUBLIC_APP_URL ?? '') + '/dashboard'` → "/dashboard".
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/billing-portal/route')
    const res = await POST(request())
    expect(res.status).toBe(500)
    expect(mockCreateBillingPortalSession).not.toHaveBeenCalled()
  })
})
