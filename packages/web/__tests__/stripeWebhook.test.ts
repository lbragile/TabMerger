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
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'

// ── Stripe mock ──────────────────────────────────────────────────────────────
const mockConstructEvent = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockPortalSessionCreate = vi.fn()
const mockListLineItems = vi.fn().mockResolvedValue({ data: [{ quantity: 1 }] })

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    billingPortal: { sessions: { create: mockPortalSessionCreate } },
    checkout: { sessions: { listLineItems: mockListLineItems } },
  },
  // app/api/billing-portal/route.ts and app/api/portal/route.ts both go through this helper
  // (not the raw `stripe` object above) so the isStripeConfigured guard actually applies to them.
  createBillingPortalSession: vi.fn(
    async ({ customerId, returnUrl }: { customerId: string; returnUrl: string }) => {
      const session = await mockPortalSessionCreate({ customer: customerId, return_url: returnUrl })
      return session.url
    }
  ),
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
  const currentPeriodEnd = (overrides.current_period_end as number | undefined) ?? 1800000000
  return {
    id: 'sub_test123',
    customer: 'cus_test123',
    status: 'active',
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_pro_monthly' }, current_period_end: currentPeriodEnd }] },
    metadata: { user_id: 'user-uuid-1' },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /api/webhooks/stripe', () => {
  // Restored after every test, so a failing assertion cannot leave console.error silenced.
  let errorSpy: ReturnType<typeof vi.spyOn> | undefined
  afterEach(() => {
    errorSpy?.mockRestore()
    errorSpy = undefined
  })

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

  it('first purchase upgrades the pre-existing free row in place (onConflict: user_id, not id)', async () => {
    // On signup the handle_new_user() trigger inserts a subscriptions row with
    // id = 'free_<uuid>' holding this user_id. A first purchase creates a brand-new
    // Stripe subscription id, so conflicting on `id` would attempt an INSERT that
    // violates the UNIQUE(user_id) constraint (Postgres 23505) and the user stays
    // on 'free'. The upsert must target user_id so the existing row is rewritten:
    // its id becomes the Stripe sub id and tier/status are upgraded — no duplicate row.
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription({ id: 'sub_firstpurchase' })
    mockSubscriptionsRetrieve.mockResolvedValue(subscription)

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_firstpurchase',
          customer: 'cus_test123',
          metadata: { user_id: 'user-uuid-1' },
        },
      },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub_firstpurchase', user_id: 'user-uuid-1', tier: 'pro' }),
      { onConflict: 'user_id' }
    )
    // Never conflict on `id` — that is the bug that left first-time buyers on 'free'.
    expect(mockUpsert).not.toHaveBeenCalledWith(expect.anything(), { onConflict: 'id' })
  })

  it('customer.subscription.updated also upserts on user_id so the row stays unique per user', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription({ cancel_at_period_end: true })

    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: subscription },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockUpsert).toHaveBeenCalledWith(expect.any(Object), { onConflict: 'user_id' })
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

  it('fires a GA4 checkout_completed event with tier/value/currency/billing on success', async () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123'
    process.env.GA_API_SECRET = 'secret_test'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const subscription = makeSubscription({
      items: {
        data: [{ price: { id: 'price_pro_monthly', unit_amount: 399 }, current_period_end: 1800000000 }],
      },
    })
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=secret_test'),
      expect.objectContaining({ method: 'POST' })
    )
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(callBody.events[0]).toEqual({
      name: 'checkout_completed',
      params: { tier: 'pro', value: 3.99, currency: 'usd', billing: 'monthly' },
    })
    // client_id must not be the raw Stripe/Supabase user id
    expect(callBody.client_id).not.toBe('user-uuid-1')
    expect(typeof callBody.client_id).toBe('string')

    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
    delete process.env.GA_API_SECRET
  })

  it('a GA4 POST failure does not break the webhook success response', async () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123'
    process.env.GA_API_SECRET = 'secret_test'
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

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
    expect(fetchMock).toHaveBeenCalled()

    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
    delete process.env.GA_API_SECRET
  })

  it('rejects a request with no stripe-signature header', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(mockConstructEvent).not.toHaveBeenCalled()
  })

  it('rejects a request with an invalid signature', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockImplementation(() => {
      throw new Error('signature mismatch')
    })

    const res = await POST(makeRequest('{}', 'bad-sig'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('signature verification failed')
    expect(mockUpsert).not.toHaveBeenCalled()
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

  it('checkout.session.completed (payment mode, ai_credit_pack) credits the purchased quantity directly', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'ai_credit_purchases') return { insert: mockInsert }
      return { upsert: mockUpsert, update: mockUpdate }
    })
    mockListLineItems.mockResolvedValue({ data: [{ quantity: 3 }] })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test123',
          mode: 'payment',
          customer: 'cus_test123',
          metadata: { user_id: 'user-uuid-1', type: 'ai_credit_pack' },
        },
      },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    expect(mockListLineItems).toHaveBeenCalledWith('cs_test123', { limit: 1 })
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-uuid-1', credits: 3, stripe_checkout_session_id: 'cs_test123' })
    )
  })

  // Checkout accepts promotion codes, so a completed session can cost less than list price or
  // nothing at all. The entitlement comes from the subscription's price and status, never from
  // what was charged. Both payment_status values are covered so the grant can't start depending
  // on which one Stripe reports for a free first invoice.
  it.each(['paid', 'no_payment_required'])(
    'checkout.session.completed with a 100%%-off code (payment_status %s) still upgrades the subscription',
    async (paymentStatus) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockSubscriptionsRetrieve.mockResolvedValue(makeSubscription({ id: 'sub_free_first_invoice' }))

      mockConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            mode: 'subscription',
            subscription: 'sub_free_first_invoice',
            customer: 'cus_test123',
            metadata: { user_id: 'user-uuid-1' },
            payment_status: paymentStatus,
            amount_subtotal: 399,
            amount_total: 0,
            total_details: { amount_discount: 399, amount_shipping: 0, amount_tax: 0 },
          },
        },
      })

      const res = await POST(makeRequest('{}'))
      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'sub_free_first_invoice',
          user_id: 'user-uuid-1',
          tier: 'pro',
          status: 'active',
          stripe_price_id: 'price_pro_monthly',
        }),
        { onConflict: 'user_id' }
      )
    }
  )

  // Credits follow the quantity on the line item, never the amount paid: a discount changes the
  // price of the pack, not its size, and a free pack is still exactly the quantity bought.
  it.each([
    ['half price', { payment_status: 'paid', amount_subtotal: 2500, amount_total: 1250, payment_intent: 'pi_test123' }],
    ['free (100% off)', { payment_status: 'paid', amount_subtotal: 2500, amount_total: 0, payment_intent: null }],
    ['free, reported as no_payment_required', { payment_status: 'no_payment_required', amount_subtotal: 2500, amount_total: 0, payment_intent: null }],
  ])('a discounted credit pack (%s) grants the quantity bought, not an amount-based number', async (_label, amounts) => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'ai_credit_purchases') return { insert: mockInsert }
      return { upsert: mockUpsert, update: mockUpdate }
    })
    mockListLineItems.mockResolvedValue({ data: [{ quantity: 500 }] })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_discounted',
          mode: 'payment',
          customer: 'cus_test123',
          metadata: { user_id: 'user-uuid-1', type: 'ai_credit_pack' },
          ...amounts,
        },
      },
    })

    const res = await POST(makeRequest('{}'))
    expect(res.status).toBe(200)
    // The quantity is read back from Stripe for THIS session, not derived from the amounts.
    expect(mockListLineItems).toHaveBeenCalledWith('cs_discounted', { limit: 1 })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-uuid-1', credits: 500, stripe_checkout_session_id: 'cs_discounted' })
    )
    // 500 is the line item's quantity; neither the amount paid nor the list price implies it.
    expect(mockInsert.mock.calls[0][0].credits).not.toBe(Number(amounts.amount_total))
    expect(mockInsert.mock.calls[0][0].credits).not.toBe(Number(amounts.amount_subtotal))
  })

  // One redemption of a code is one Checkout Session, and a session can be credited once: the
  // insert is keyed on the session id, so a redelivered event hits the unique constraint (23505)
  // and is dropped without an error. How often a code can be redeemed is Stripe's limit to enforce.
  it('a redelivered free credit-pack event is keyed on the same session and the duplicate is ignored', async () => {
    const mockInsert = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key value' } })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'ai_credit_purchases') return { insert: mockInsert }
      return { upsert: mockUpsert, update: mockUpdate }
    })
    mockListLineItems.mockResolvedValue({ data: [{ quantity: 500 }] })
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_free_pack',
          mode: 'payment',
          customer: 'cus_test123',
          metadata: { user_id: 'user-uuid-1', type: 'ai_credit_pack' },
          payment_status: 'paid',
          amount_total: 0,
          payment_intent: null,
        },
      },
    })

    const first = await POST(makeRequest('{}'))
    const second = await POST(makeRequest('{}'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mockInsert).toHaveBeenCalledTimes(2)
    expect(mockInsert.mock.calls[0][0].stripe_checkout_session_id).toBe('cs_free_pack')
    expect(mockInsert.mock.calls[1][0].stripe_checkout_session_id).toBe('cs_free_pack')
    expect(errorSpy).not.toHaveBeenCalled()
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
