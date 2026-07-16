/**
 * Tests for PAY-001: Stripe subscription lifecycle
 *
 * Tests the webhook handler at app/api/webhooks/stripe/route.ts
 * and the billing portal at app/api/portal/route.ts.
 *
 * These tests will FAIL until the implementation adds:
 *   - cancel_at_period_end, current_period_end, stripe_price_id columns
 *   - invoice.payment_failed handler
 *   - idempotency (upsert semantics already present, but tested explicitly)
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// ── Stripe mock ──────────────────────────────────────────────────────────────
const mockConstructEvent = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockPortalSessionCreate = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    billingPortal: { sessions: { create: mockPortalSessionCreate } },
  },
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockFrom = vi.fn()
const mockCreateClient = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn().mockResolvedValue({
    from: mockFrom,
  }),
  createClient: mockCreateClient,
}))

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: string, sig = 'test-sig') {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': sig, 'content-type': 'text/plain' },
    body,
  })
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_test123',
    customer: 'cus_test123',
    status: 'active',
    current_period_end: 1800000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    metadata: { user_id: 'user-uuid-1' },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_pro_monthly'
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_yearly'
    process.env.STRIPE_PRO_AI_MONTHLY_PRICE_ID = 'price_pro_ai_monthly'
    process.env.STRIPE_PRO_AI_YEARLY_PRICE_ID = 'price_pro_ai_yearly'

    // Default: from() returns a chainable mock that resolves profiles lookup
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'user-uuid-1' } }),
          update: vi.fn().mockReturnThis(),
        }
      }
      return {
        upsert: mockUpsert,
        update: mockUpdate,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
      }
    })
  })

  it('checkout.session.completed upserts subscription with correct fields', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription()
    mockSubscriptionsRetrieve.mockResolvedValue(subscription)

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_test123',
          customer: 'cus_test123',
          metadata: { user_id: 'user-uuid-1' },
        },
      },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    // Must include NEW PAY-001 columns: cancel_at_period_end and stripe_price_id
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sub_test123',
        user_id: 'user-uuid-1',
        tier: 'pro',
        status: 'active',
        cancel_at_period_end: false,
        stripe_price_id: 'price_pro_monthly',
      }),
      expect.anything()
    )
  })

  it('replaying the same checkout.session.completed event is idempotent', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription()
    mockSubscriptionsRetrieve.mockResolvedValue(subscription)

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_test123',
          customer: 'cus_test123',
          metadata: { user_id: 'user-uuid-1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)

    const res1 = await POST(makeRequest('{}'))
    const res2 = await POST(makeRequest('{}'))

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
    // upsert called twice — no duplicates because upsert semantics on id
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    // Both calls have the same row id — no duplicate rows
    const calls = mockUpsert.mock.calls
    expect(calls[0][0].id).toBe(calls[1][0].id)
    // Both calls must include the NEW PAY-001 columns
    expect(calls[0][0]).toMatchObject({ cancel_at_period_end: false, stripe_price_id: 'price_pro_monthly' })
    expect(calls[1][0]).toMatchObject({ cancel_at_period_end: false, stripe_price_id: 'price_pro_monthly' })
  })

  it('customer.subscription.updated with cancel_at_period_end=true updates the DB row', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription({
      cancel_at_period_end: true,
      current_period_end: 1900000000,
    })

    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: subscription },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        cancel_at_period_end: true,
        current_period_end: new Date(1900000000 * 1000).toISOString(),
      }),
      expect.anything()
    )
  })

  it('customer.subscription.deleted sets status to canceled', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription({ status: 'canceled' })

    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: subscription },
    })

    const subscriptionUpdateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'user-uuid-1' } }),
        }
      }
      // subscriptions table
      return { update: subscriptionUpdateSpy, upsert: mockUpsert }
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    expect(subscriptionUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' })
    )
  })

  it('invoice.payment_failed sets status to past_due', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')

    mockConstructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_test123',
          customer: 'cus_test123',
        },
      },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    // The handler must update the subscription status to 'past_due'
    // This will fail until invoice.payment_failed is implemented
    const allUpsertCalls = mockUpsert.mock.calls.flat()
    const updateCalls = (mockUpdate as Mock).mock?.calls ?? []
    const didSetPastDue =
      allUpsertCalls.some((arg: unknown) => (arg as Record<string, unknown>)?.status === 'past_due') ||
      updateCalls.some((args: unknown[]) =>
        args.some((a) => (a as Record<string, unknown>)?.status === 'past_due')
      )
    expect(didSetPastDue).toBe(true)
  })
})

describe('POST /api/portal', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://tabmerger.app'

    // Default: authenticated user with a billing account
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-uuid-1' } }, error: null }),
      },
    })

    const { createServiceRoleClient } = await import('@/lib/supabase/server')
    ;(createServiceRoleClient as Mock).mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: 'cus_test123' } }),
      }),
    })
  })

  it('returns a URL when user has a stripe_customer_id', async () => {
    const { POST } = await import('@/app/api/billing-portal/route')
    mockPortalSessionCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/test' })

    const req = new NextRequest('http://localhost/api/billing-portal', { method: 'POST' })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('stripe.com')
  })

  it('returns 400 when user has no stripe_customer_id', async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/server')
    ;(createServiceRoleClient as Mock).mockResolvedValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: null } }),
      }),
    })

    const { POST } = await import('@/app/api/billing-portal/route')
    const req = new NextRequest('http://localhost/api/billing-portal', { method: 'POST' })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

// ── Edge cases ────────────────────────────────────────────────────────────────
describe('PAY-001 edge cases', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'

    // Re-anchor createServiceRoleClient to mockFrom (portal beforeEach may have changed it)
    const { createServiceRoleClient } = await import('@/lib/supabase/server')
    ;(createServiceRoleClient as Mock).mockResolvedValue({ from: mockFrom })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null }), // no profile found
          update: vi.fn().mockReturnThis(),
        }
      }
      return { upsert: mockUpsert, update: mockUpdate }
    })
  })

  it('checkout.session.completed with no resolvable user_id does not crash — returns 200', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')

    mockSubscriptionsRetrieve.mockResolvedValue({
      id: 'sub_orphan',
      customer: 'cus_orphan',
      status: 'active',
      current_period_end: 1800000000,
      cancel_at_period_end: false,
      items: { data: [{ price: { id: 'price_pro_monthly' } }] },
      metadata: {}, // no user_id in metadata
    })

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_orphan',
          customer: 'cus_orphan',
          metadata: {}, // no user_id in session metadata either
          client_reference_id: null,
        },
      },
    })

    const res = await POST(makeRequest('{}'))
    // Handler must not crash — breaks out of switch and returns 200
    expect(res.status).toBe(200)
    // No subscription should be persisted for an unresolvable user
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})
