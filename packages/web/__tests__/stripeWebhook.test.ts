/**
 * Tests for PAY-001: Stripe subscription lifecycle
 *
 * Tests the webhook handler at app/api/webhooks/stripe/route.ts
 * and the billing portal at app/api/portal/route.ts.
 *
 * What the webhook tests pin:
 *   - the columns written for a subscription (tier, status, stripe_price_id, cancel_at_period_end,
 *     current_period_end) and the upsert's conflict target (user_id: one row per user)
 *   - which row each later event changes (matched by Stripe subscription id)
 *   - a row only ever holds a stored status; any other Stripe status is written as canceled / free
 *   - the status code: 200 when the event is recorded or matches nothing, 500 when a database
 *     call fails, and the same event delivered twice leaves the same row
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'
import { STORED_SUBSCRIPTION_STATUSES, isEntitledSubscriptionStatus } from '@tabmerger/shared'

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
// update(...).eq('id', …).select('id') resolves with the rows that matched.
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockReturnValue({
    select: vi.fn().mockResolvedValue({ data: [{ id: 'sub_test123' }], error: null }),
  }),
})
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
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'user-uuid-1' } }),
          update: vi.fn().mockReturnThis(),
        }
      }
      return {
        upsert: mockUpsert,
        update: mockUpdate,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
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
    // Each delivery upserts with user_id as the conflict target, so the second one rewrites the
    // row the first one wrote: one row per user, however often the event arrives.
    expect(mockUpsert).toHaveBeenCalledTimes(2)
    const calls = mockUpsert.mock.calls
    expect(calls[0][1]).toEqual({ onConflict: 'user_id' })
    expect(calls[1][1]).toEqual({ onConflict: 'user_id' })
    expect(calls[0][0].user_id).toBe(calls[1][0].user_id)
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
    mockSubscriptionsRetrieve.mockResolvedValue(subscription)

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
    mockSubscriptionsRetrieve.mockResolvedValue(subscription)

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
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: 'sub_test123' }], error: null }),
      }),
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
    // The status written is the one the subscription has at Stripe when the event is handled.
    mockSubscriptionsRetrieve.mockResolvedValue(makeSubscription({ status: 'past_due' }))

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

// Later subscription events are matched by Stripe subscription id. An update resolves its user
// from the stored row, then the subscription's metadata, then the customer's profile; a
// cancellation or failed payment changes only the row stored under that subscription id.
describe('subscription events are matched by subscription id', () => {
  const USER_A = '11111111-1111-4111-8111-111111111111'
  const USER_B = '22222222-2222-4222-8222-222222222222'

  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  /**
   * In-memory stand-in for the two tables the handler reads.
   * - `rowUserId`: owner of the row stored under the event's subscription id (null = no such row)
   * - `profileIds`: user ids that have a profile
   * - `customerProfileId`: the profile whose stripe_customer_id is the event's customer (null = none)
   * - `matchedRows`: what update(...).eq('id', …).select('id') returns
   * - `rowError`, `profileLookupErrors` (by the column looked up), `updateError`,
   *   `profileUpdateError`: the database error that call answers with instead
   */
  type DbError = { code: string; message?: string; details?: string }

  function mockTables({
    rowUserId = null,
    rowError = null,
    profileIds = [],
    customerProfileId = null,
    matchedRows = [],
    profileLookupErrors = {},
    updateError = null,
    profileUpdateError = null,
  }: {
    rowUserId?: string | null
    rowError?: DbError | null
    profileIds?: string[]
    customerProfileId?: string | null
    matchedRows?: { id: string }[]
    profileLookupErrors?: { id?: DbError; stripe_customer_id?: DbError }
    updateError?: DbError | null
    profileUpdateError?: DbError | null
  } = {}) {
    const update = vi.fn()
    const updateEq = vi.fn()
    const subscriptionEq = vi.fn()
    const profileEq = vi.fn()
    const profileUpdate = vi.fn()

    mockFrom.mockImplementation((table: string) => {
      if (table === 'profiles') {
        let column = ''
        let value = ''
        const lookup = async () => {
          const error = profileLookupErrors[column as 'id' | 'stripe_customer_id'] ?? null
          if (error) return { data: null, error }
          if (column === 'id') {
            return { data: profileIds.includes(value) ? { id: value } : null, error: null }
          }
          return { data: customerProfileId ? { id: customerProfileId } : null, error: null }
        }
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn((c: string, v: string) => {
            column = c
            value = v
            profileEq(c, v)
            return chain
          }),
          maybeSingle: vi.fn(lookup),
          // Like PostgREST, single() answers "no row" with an error of its own code.
          single: vi.fn(async () => {
            const result = await lookup()
            if (result.data || result.error) return result
            return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
          }),
          update: vi.fn((changes: unknown) => {
            profileUpdate(changes)
            return { eq: vi.fn(async () => ({ error: profileUpdateError })) }
          }),
        }
        return chain
      }

      return {
        upsert: mockUpsert,
        select: vi.fn(() => ({
          eq: vi.fn((c: string, v: string) => {
            subscriptionEq(c, v)
            return {
              maybeSingle: vi.fn(async () => ({
                data: rowUserId ? { user_id: rowUserId } : null,
                error: rowError,
              })),
            }
          }),
        })),
        update: vi.fn((changes: unknown) => {
          update(changes)
          return {
            eq: vi.fn((c: string, v: string) => {
              updateEq(c, v)
              return {
                select: vi.fn(async () =>
                  updateError ? { data: null, error: updateError } : { data: matchedRows, error: null }
                ),
              }
            }),
          }
        }),
      }
    })

    return { update, updateEq, subscriptionEq, profileEq, profileUpdate }
  }

  /** A completed subscription checkout whose session and subscription carry no user metadata. */
  function checkoutEvent(sessionMetadata: Record<string, string> = {}) {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test123',
          mode: 'subscription',
          subscription: 'sub_test123',
          customer: 'cus_test123',
          metadata: sessionMetadata,
        },
      },
    }
  }

  /**
   * What `stripe.subscriptions.retrieve` answers: the subscription's current state at Stripe,
   * which is what an update and a failed payment write.
   */
  function stripeNowHas(overrides: Record<string, unknown> = {}) {
    const subscription = makeSubscription({ metadata: {}, ...overrides })
    mockSubscriptionsRetrieve.mockResolvedValue(subscription)
    return subscription
  }

  /** The error the Stripe SDK throws for a failed API call (the fields the handler reads, and more). */
  function stripeApiError(fields: { type: string; statusCode?: number; code?: string }) {
    return Object.assign(new Error('stripe-message-marker'), {
      ...fields,
      requestId: 'req_marker',
      headers: { 'request-id': 'req_marker' },
      raw: { message: 'raw-marker' },
    })
  }

  /**
   * A subscription event. Unless a test says otherwise afterwards with stripeNowHas(), Stripe's
   * current state of the subscription is the same as the object embedded in the event.
   */
  function subscriptionEvent(type: string, overrides: Record<string, unknown> = {}) {
    return { type, data: { object: stripeNowHas(overrides) } }
  }

  /** A failed-payment event for an invoice that bills `subscriptionId`. */
  function paymentFailedEvent(subscriptionId = 'sub_test123') {
    return {
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_test123', customer: 'cus_test123', subscription: subscriptionId } },
    }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    // No answer left over from an earlier test: a test that needs Stripe's state sets it.
    mockSubscriptionsRetrieve.mockReset()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.STRIPE_PRO_MONTHLY_PRICE_ID = 'price_pro_monthly'
    process.env.STRIPE_PRO_YEARLY_PRICE_ID = 'price_pro_yearly'

    const { createServiceRoleClient } = await import('@/lib/supabase/server')
    ;(createServiceRoleClient as Mock).mockResolvedValue({ from: mockFrom })

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  describe('customer.subscription.deleted', () => {
    it('ends the row stored under the subscription id, with no profile lookup', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update, updateEq, profileEq } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.deleted', { status: 'canceled' })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(update).toHaveBeenCalledWith({ status: 'canceled', tier: 'free' })
      expect(updateEq).toHaveBeenCalledWith('id', 'sub_test123')
      expect(profileEq).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('returns 200 and logs the event type and subscription id when no row has that id', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { updateEq } = mockTables({ matchedRows: [] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.deleted', { status: 'canceled' })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      // The only write attempted is keyed on the subscription id, and it matched nothing.
      expect(updateEq).toHaveBeenCalledTimes(1)
      expect(updateEq).toHaveBeenCalledWith('id', 'sub_test123')
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0]).toEqual([
        'Stripe webhook: customer.subscription.deleted matched no subscription row or user (subscription sub_test123)',
      ])
    })
  })

  describe('customer.subscription.updated', () => {
    it('uses the owner of the row stored under the subscription id when no profile holds the customer', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { subscriptionEq, profileEq } = mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { cancel_at_period_end: true })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(subscriptionEq).toHaveBeenCalledWith('id', 'sub_test123')
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, cancel_at_period_end: true }),
        { onConflict: 'user_id' }
      )
      // The stored row is enough: no profile is read.
      expect(profileEq).not.toHaveBeenCalled()
    })

    it('uses metadata.user_id when no row holds the subscription id yet and that profile exists', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { profileEq } = mockTables({ profileIds: [USER_A] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_A } })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, tier: 'pro', status: 'active' }),
        { onConflict: 'user_id' }
      )
      expect(profileEq).toHaveBeenCalledWith('id', USER_A)
      expect(profileEq).not.toHaveBeenCalledWith('stripe_customer_id', expect.anything())
    })

    it('the stored row wins over a metadata.user_id that names another user', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A, profileIds: [USER_A, USER_B], customerProfileId: USER_B })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_B } })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert.mock.calls[0][0].user_id).toBe(USER_A)
      // The mismatch is logged with the subscription id only.
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0][0])).toContain('sub_test123')
      expect(String(warnSpy.mock.calls[0][0])).not.toContain(USER_A)
      expect(String(warnSpy.mock.calls[0][0])).not.toContain(USER_B)
    })

    it('metadata.user_id wins over the profile that holds the customer', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ profileIds: [USER_A, USER_B], customerProfileId: USER_B })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_A } })
      )

      await POST(makeRequest('{}'))

      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert.mock.calls[0][0].user_id).toBe(USER_A)
    })

    it.each([
      ['is not shaped like a user id', 'not-a-user-id', [] as string[]],
      ['names no existing profile', USER_B, [USER_A]],
    ])('a metadata.user_id that %s is skipped, and the customer profile is used', async (_label, metadataUserId, profileIds) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { profileEq } = mockTables({ profileIds, customerProfileId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: metadataUserId } })
      )

      await POST(makeRequest('{}'))

      expect(profileEq).toHaveBeenCalledWith('stripe_customer_id', 'cus_test123')
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert.mock.calls[0][0].user_id).toBe(USER_A)
    })

    it('a value that is not shaped like a user id is never used as a lookup key', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { profileEq } = mockTables()
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: 'not-a-user-id' } })
      )

      await POST(makeRequest('{}'))

      expect(profileEq).not.toHaveBeenCalledWith('id', expect.anything())
    })

    it('falls back to the profile that holds the customer when there is no row and no metadata', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ customerProfileId: USER_A })
      mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated'))

      await POST(makeRequest('{}'))

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: USER_A }),
        { onConflict: 'user_id' }
      )
    })

    it('returns 200, writes nothing and logs type + subscription id when no key resolves', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables()
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          metadata: { user_id: USER_B, note: 'private-note' },
        })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated matched no subscription row or user (subscription sub_test123)'],
      ])
      // Nothing from the payload beyond the subscription id reaches the log.
      const logged = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls])
      expect(logged).not.toContain('cus_test123')
      expect(logged).not.toContain(USER_B)
      expect(logged).not.toContain('private-note')
    })

    it('answers 500 and tries no weaker key when the stored row cannot be read', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { profileEq } = mockTables({
        rowError: { code: 'PGRST000' },
        profileIds: [USER_A],
        customerProfileId: USER_A,
      })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_A } })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(profileEq).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated subscription lookup failed (subscription sub_test123, code PGRST000)'],
      ])
    })

    it('answers 500 and does not fall through to the customer when the metadata profile cannot be read', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { profileEq } = mockTables({
        profileIds: [USER_A],
        customerProfileId: USER_B,
        profileLookupErrors: { id: { code: 'PGRST000' } },
      })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_A } })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(profileEq).toHaveBeenCalledTimes(1)
      expect(profileEq).toHaveBeenCalledWith('id', USER_A)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated metadata profile lookup failed (subscription sub_test123, code PGRST000)'],
      ])
    })

    it('answers 500 when the customer profile cannot be read, which is not the same as no match', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ profileLookupErrors: { stripe_customer_id: { code: '57014' } } })
      mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated'))

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(mockUpsert).not.toHaveBeenCalled()
      // Not reported as an event that matched nothing.
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated customer profile lookup failed (subscription sub_test123, code 57014)'],
      ])
    })

    it('answers 500 when the upsert fails, and logs the code and message only', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockUpsert.mockResolvedValueOnce({
        error: {
          code: '08006',
          message: 'connection failure',
          details: 'Failing row contains (row-detail-marker)',
          hint: 'hint-marker',
        },
      })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { note: 'private-note' } })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated upsert failed (subscription sub_test123, code 08006): connection failure'],
      ])
      const logged = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls])
      expect(logged).not.toContain('row-detail-marker')
      expect(logged).not.toContain('hint-marker')
      expect(logged).not.toContain('cus_test123')
      expect(logged).not.toContain(USER_A)
      expect(logged).not.toContain('private-note')
    })

    it('the same event delivered again after a 500 writes the row and answers 200', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockUpsert.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { cancel_at_period_end: true })
      )

      const first = await POST(makeRequest('{}'))
      const second = await POST(makeRequest('{}'))

      expect(first.status).toBe(500)
      expect(second.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledTimes(2)
      // Both deliveries address the same row with the same values (updated_at aside).
      const [firstRow, firstOptions] = mockUpsert.mock.calls[0]
      const [secondRow, secondOptions] = mockUpsert.mock.calls[1]
      expect(firstOptions).toEqual({ onConflict: 'user_id' })
      expect(secondOptions).toEqual({ onConflict: 'user_id' })
      expect({ ...secondRow, updated_at: null }).toEqual({ ...firstRow, updated_at: null })
    })
  })

  // Stripe does not deliver events in order and can deliver one again much later. An update and a
  // failed payment therefore write the subscription's current state, read from Stripe by the id
  // in the event, and never the copy embedded in the event.
  describe("an update and a failed payment write Stripe's current state", () => {
    it('customer.subscription.updated retrieves the subscription by the id in the event', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated'))

      await POST(makeRequest('{}'))

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(1)
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_test123')
    })

    it('the event says active and Stripe says canceled: the row ends canceled on the free tier', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { status: 'active' })
      )
      stripeNowHas({ status: 'canceled' })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, status: 'canceled', tier: 'free' }),
        { onConflict: 'user_id' }
      )
    })

    it('the event says past_due and Stripe says active: the row is active with the tier of the price', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { status: 'past_due' })
      )
      stripeNowHas({ status: 'active' })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, status: 'active', tier: 'pro' }),
        { onConflict: 'user_id' }
      )
    })

    it('every written column comes from the retrieved subscription', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          cancel_at_period_end: false,
          current_period_end: 1800000000,
        })
      )
      stripeNowHas({
        cancel_at_period_end: true,
        current_period_end: 1900000000,
        items: { data: [{ price: { id: 'price_pro_yearly' }, current_period_end: 1900000000 }] },
      })

      await POST(makeRequest('{}'))

      expect(mockUpsert.mock.calls[0][0]).toMatchObject({
        tier: 'pro',
        stripe_price_id: 'price_pro_yearly',
        cancel_at_period_end: true,
        current_period_end: new Date(1900000000 * 1000).toISOString(),
      })
    })

    it('an update delivered again after the cancellation leaves the row ended', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')

      // The cancellation arrives first and ends the row.
      const { update } = mockTables({ rowUserId: USER_A, matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.deleted', { status: 'canceled' })
      )
      const cancellation = await POST(makeRequest('{}'))

      // Then an update made while the subscription was still active is delivered again. Stripe
      // has the subscription as canceled by now.
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { status: 'active', cancel_at_period_end: true })
      )
      stripeNowHas({ status: 'canceled' })
      const lateUpdate = await POST(makeRequest('{}'))

      expect(cancellation.status).toBe(200)
      expect(lateUpdate.status).toBe(200)
      expect(update.mock.calls).toEqual([[{ status: 'canceled', tier: 'free' }]])
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      const { status, tier } = mockUpsert.mock.calls[0][0]
      expect({ status, tier }).toEqual({ status: 'canceled', tier: 'free' })
      expect(isEntitledSubscriptionStatus(status)).toBe(false)
    })

    it.each([
      ['a network error', { type: 'StripeConnectionError' }, 'StripeConnectionError'],
      ['a server error', { type: 'StripeAPIError', statusCode: 500 }, 'StripeAPIError, status 500'],
      ['a rate limit', { type: 'StripeRateLimitError', statusCode: 429, code: 'rate_limit' }, 'StripeRateLimitError, status 429'],
    ])('answers 500 and writes nothing when the retrieve fails with %s', async (_label, fields, logged) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { subscriptionEq, profileEq } = mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { status: 'active' })
      )
      mockSubscriptionsRetrieve.mockRejectedValue(stripeApiError(fields))

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      // The embedded object is not used in place of the state that could not be read.
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(subscriptionEq).not.toHaveBeenCalled()
      expect(profileEq).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        [`Stripe webhook: customer.subscription.updated subscription retrieve failed (subscription sub_test123, ${logged})`],
      ])
      const lines = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls])
      expect(lines).not.toContain('req_marker')
      expect(lines).not.toContain('raw-marker')
      expect(lines).not.toContain('stripe-message-marker')
      expect(lines).not.toContain('cus_test123')
    })

    it('answers 200, writes nothing and logs type + subscription id when Stripe has no such subscription', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update, subscriptionEq } = mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_A } })
      )
      mockSubscriptionsRetrieve.mockRejectedValue(
        stripeApiError({ type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing' })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(subscriptionEq).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated matched no subscription row or user (subscription sub_test123)'],
      ])
    })

    it.each([
      ['another subscription', { id: 'sub_other' }],
      ['nothing', null],
    ])('answers 500 and writes nothing when the retrieve returns %s', async (_label, retrieved) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { subscriptionEq } = mockTables({ rowUserId: USER_A, profileIds: [USER_A] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { metadata: { user_id: USER_A } })
      )
      if (retrieved) stripeNowHas({ ...retrieved, metadata: { user_id: USER_A } })
      else mockSubscriptionsRetrieve.mockResolvedValue(undefined)

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(mockUpsert).not.toHaveBeenCalled()
      // No row is looked up under either id.
      expect(subscriptionEq).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: customer.subscription.updated retrieved a subscription other than the one asked for; nothing is written (subscription sub_test123)'],
      ])
    })

    it.each([
      ['still past_due', 'past_due', { status: 'past_due' }],
      ['paid since, and active again', 'active', { status: 'active' }],
      ['canceled since', 'canceled', { status: 'canceled', tier: 'free' }],
      ['unpaid since', 'unpaid', { status: 'canceled', tier: 'free' }],
    ])('invoice.payment_failed for a subscription that is %s writes that state', async (_label, status, expected) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update, updateEq } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(paymentFailedEvent())
      stripeNowHas({ status })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_test123')
      expect(update.mock.calls).toEqual([[expected]])
      expect(updateEq).toHaveBeenCalledWith('id', 'sub_test123')
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('invoice.payment_failed answers 500 and writes nothing when the retrieve fails', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(paymentFailedEvent())
      mockSubscriptionsRetrieve.mockRejectedValue(stripeApiError({ type: 'StripeAPIError', statusCode: 503 }))

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(update).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: invoice.payment_failed subscription retrieve failed (subscription sub_test123, StripeAPIError, status 503)'],
      ])
    })

    it('invoice.payment_failed answers 200 and writes nothing when Stripe has no such subscription', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(paymentFailedEvent())
      mockSubscriptionsRetrieve.mockRejectedValue(
        stripeApiError({ type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing' })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(update).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([
        ['Stripe webhook: invoice.payment_failed matched no subscription row or user (subscription sub_test123)'],
      ])
    })

    it('customer.subscription.deleted ends the row without asking Stripe', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.deleted', { status: 'canceled' })
      )
      mockSubscriptionsRetrieve.mockClear()

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
      expect(update).toHaveBeenCalledWith({ status: 'canceled', tier: 'free' })
    })

    it('checkout.session.completed answers 500 when its subscription cannot be read or is not found', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables()
      mockConstructEvent.mockReturnValue(checkoutEvent({ user_id: USER_A }))

      mockSubscriptionsRetrieve.mockRejectedValueOnce(stripeApiError({ type: 'StripeAPIError', statusCode: 500 }))
      const unreadable = await POST(makeRequest('{}'))
      mockSubscriptionsRetrieve.mockRejectedValueOnce(
        stripeApiError({ type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing' })
      )
      const missing = await POST(makeRequest('{}'))

      expect(unreadable.status).toBe(500)
      expect(missing.status).toBe(500)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: checkout.session.completed subscription retrieve failed (subscription sub_test123, StripeAPIError, status 500)'],
        ['Stripe webhook: checkout.session.completed subscription not found at Stripe (subscription sub_test123)'],
      ])
    })
  })

  // The upsert rewrites the user's one row. A subscription that row does not track (the user was
  // resolved through metadata or the profile, not through the stored row) may take the row over
  // only while it is entitled, so an event about an ended or unpaid subscription never replaces
  // the plan the row holds.
  describe('a subscription the row does not track takes it over only while entitled', () => {
    const ignoredLine = (status: string, id = 'sub_test123') =>
      `Stripe webhook: customer.subscription.updated ignored: the subscription is not the one on record and its status is ${status} (subscription ${id})`

    it('an update for an ended earlier subscription leaves the row of the current one alone', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      // The row holds the current subscription's id, so no row is stored under 'sub_earlier'.
      const { update, subscriptionEq } = mockTables({ profileIds: [USER_A], customerProfileId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          id: 'sub_earlier',
          status: 'active',
          metadata: { user_id: USER_A },
        })
      )
      stripeNowHas({ id: 'sub_earlier', status: 'canceled', metadata: { user_id: USER_A } })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(subscriptionEq).toHaveBeenCalledWith('id', 'sub_earlier')
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([[ignoredLine('canceled', 'sub_earlier')]])
      // Event type, subscription id and status only.
      const lines = JSON.stringify(warnSpy.mock.calls)
      expect(lines).not.toContain(USER_A)
      expect(lines).not.toContain('cus_test123')
    })

    it.each([
      ['metadata', 'canceled'],
      ['metadata', 'incomplete'],
      ['metadata', 'incomplete_expired'],
      ['metadata', 'unpaid'],
      ['metadata', 'paused'],
      ['profile', 'canceled'],
      ['profile', 'incomplete'],
      ['profile', 'unpaid'],
    ])('resolved through the %s with status %s: nothing is written', async (via, status) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables(
        via === 'metadata' ? { profileIds: [USER_A] } : { customerProfileId: USER_A }
      )
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          status,
          metadata: via === 'metadata' ? { user_id: USER_A } : {},
        })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(update).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([[ignoredLine(status)]])
    })

    // First purchase: Stripe may deliver the new subscription's update before the completed
    // checkout, while the user's row is still the one made at signup.
    it.each([
      ['metadata', 'active'],
      ['metadata', 'trialing'],
      ['metadata', 'past_due'],
      ['profile', 'active'],
    ])('resolved through the %s with the entitled status %s: it takes over the row', async (via, status) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables(via === 'metadata' ? { profileIds: [USER_A] } : { customerProfileId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          status,
          metadata: via === 'metadata' ? { user_id: USER_A } : {},
        })
      )

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(isEntitledSubscriptionStatus(status)).toBe(true)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, status, tier: 'pro' }),
        { onConflict: 'user_id' }
      )
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('an incomplete first update is ignored, and the completed checkout then writes the row', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ profileIds: [USER_A] })

      // The update arrives first, while the first payment has not gone through.
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', {
          status: 'incomplete',
          metadata: { user_id: USER_A },
        })
      )
      const early = await POST(makeRequest('{}'))
      expect(early.status).toBe(200)
      expect(mockUpsert).not.toHaveBeenCalled()

      // The checkout completes: the purchase itself says whose row this is.
      mockConstructEvent.mockReturnValue(checkoutEvent({ user_id: USER_A }))
      stripeNowHas({ status: 'active', metadata: { user_id: USER_A } })
      const checkout = await POST(makeRequest('{}'))

      expect(checkout.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, status: 'active', tier: 'pro' }),
        { onConflict: 'user_id' }
      )
    })

    it('a completed checkout writes the row whatever status its subscription has', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables()
      mockConstructEvent.mockReturnValue(checkoutEvent({ user_id: USER_A }))
      stripeNowHas({ status: 'incomplete', metadata: { user_id: USER_A } })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, status: 'incomplete', tier: 'pro' }),
        { onConflict: 'user_id' }
      )
    })

    it.each([
      ['canceled', { status: 'canceled', tier: 'free' }],
      ['unpaid', { status: 'canceled', tier: 'free' }],
      ['incomplete', { status: 'incomplete', tier: 'pro' }],
    ])('the subscription the row tracks is still written when its status is %s', async (status, expected) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', { status }))

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledTimes(1)
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ id: 'sub_test123', user_id: USER_A, ...expected })
      const lines = JSON.stringify(warnSpy.mock.calls)
      expect(lines).not.toContain('not the one on record')
    })
  })

  // subscriptions.status holds one of STORED_SUBSCRIPTION_STATUSES. Stripe has more statuses than
  // that, so every write goes through one mapping: a stored status is written as is, any other
  // one ends the plan (canceled / free), which is the state a cancellation leaves.
  describe('a row only ever holds a stored status', () => {
    it.each(['unpaid', 'paused', 'incomplete_expired', 'a_status_stripe_adds_later'])(
      'customer.subscription.updated with status %s writes a stored status that does not entitle, on the free tier',
      async (status) => {
        const { POST } = await import('@/app/api/webhooks/stripe/route')
        mockTables({ rowUserId: USER_A })
        mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', { status }))

        const res = await POST(makeRequest('{}'))

        expect(res.status).toBe(200)
        expect(mockUpsert).toHaveBeenCalledTimes(1)
        const [row, options] = mockUpsert.mock.calls[0]
        expect(options).toEqual({ onConflict: 'user_id' })
        expect(isEntitledSubscriptionStatus(row.status)).toBe(false)
        expect(STORED_SUBSCRIPTION_STATUSES).toContain(row.status)
        expect(row).toMatchObject({
          id: 'sub_test123',
          user_id: USER_A,
          status: 'canceled',
          tier: 'free',
          stripe_price_id: 'price_pro_monthly',
        })
        expect(warnSpy.mock.calls).toEqual([
          [`Stripe webhook: customer.subscription.updated status ${status} is not a stored status; the row is written as canceled (subscription sub_test123)`],
        ])
        expect(errorSpy).not.toHaveBeenCalled()
      }
    )

    it.each(STORED_SUBSCRIPTION_STATUSES.filter((status) => status !== 'canceled'))(
      'customer.subscription.updated with the stored status %s writes it unchanged, with the tier of its price',
      async (status) => {
        const { POST } = await import('@/app/api/webhooks/stripe/route')
        mockTables({ rowUserId: USER_A })
        mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', { status }))

        const res = await POST(makeRequest('{}'))

        expect(res.status).toBe(200)
        expect(mockUpsert).toHaveBeenCalledTimes(1)
        expect(mockUpsert.mock.calls[0][0]).toMatchObject({ status, tier: 'pro' })
        expect(warnSpy).not.toHaveBeenCalled()
      }
    )

    // canceled is stored, so it is written as is; its tier is free whichever event reports it,
    // which is the row a customer.subscription.deleted event leaves.
    it.each(['customer.subscription.updated', 'checkout.session.completed', 'invoice.payment_failed'])(
      '%s for a canceled subscription writes canceled with the free tier',
      async (type) => {
        const { POST } = await import('@/app/api/webhooks/stripe/route')
        const { update } = mockTables({ rowUserId: USER_A, matchedRows: [{ id: 'sub_test123' }] })
        mockConstructEvent.mockReturnValue(
          type === 'customer.subscription.updated'
            ? subscriptionEvent(type)
            : type === 'checkout.session.completed'
              ? checkoutEvent()
              : paymentFailedEvent()
        )
        stripeNowHas({ status: 'canceled', metadata: { user_id: USER_A } })

        const res = await POST(makeRequest('{}'))

        expect(res.status).toBe(200)
        const written =
          type === 'invoice.payment_failed' ? update.mock.calls[0][0] : mockUpsert.mock.calls[0][0]
        expect(written).toMatchObject({ status: 'canceled', tier: 'free' })
        // A stored status: nothing is logged about mapping it.
        expect(warnSpy).not.toHaveBeenCalled()
      }
    )

    it('a status that is not stored leaves the same status and tier as a cancellation', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')

      const { update } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.deleted', { status: 'canceled' })
      )
      await POST(makeRequest('{}'))
      const afterCancellation = update.mock.calls[0][0]

      mockTables({ rowUserId: USER_A })
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.updated', { status: 'unpaid' })
      )
      await POST(makeRequest('{}'))
      const { status, tier } = mockUpsert.mock.calls[0][0]

      expect(afterCancellation).toEqual({ status: 'canceled', tier: 'free' })
      expect({ status, tier }).toEqual(afterCancellation)
    })

    it('a later event with a stored status writes the plan back', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ rowUserId: USER_A })

      mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', { status: 'paused' }))
      await POST(makeRequest('{}'))
      mockConstructEvent.mockReturnValue(subscriptionEvent('customer.subscription.updated', { status: 'active' }))
      await POST(makeRequest('{}'))

      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ status: 'canceled', tier: 'free' })
      expect(mockUpsert.mock.calls[1][0]).toMatchObject({ status: 'active', tier: 'pro' })
    })

    it('checkout.session.completed maps the status of the subscription it retrieves the same way', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables()
      mockSubscriptionsRetrieve.mockResolvedValue(
        makeSubscription({ status: 'incomplete_expired', metadata: { user_id: USER_A } })
      )
      mockConstructEvent.mockReturnValue(checkoutEvent())

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, status: 'canceled', tier: 'free' }),
        { onConflict: 'user_id' }
      )
    })

    it.each([
      ['customer.subscription.deleted', { status: 'canceled', tier: 'free' }],
      ['invoice.payment_failed', { status: 'past_due' }],
    ])('%s writes a stored status', async (type, expected) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      if (type === 'invoice.payment_failed') {
        mockConstructEvent.mockReturnValue(paymentFailedEvent())
        stripeNowHas({ status: 'past_due' })
      } else {
        mockConstructEvent.mockReturnValue(subscriptionEvent(type, { status: 'canceled' }))
      }

      await POST(makeRequest('{}'))

      expect(update).toHaveBeenCalledWith(expected)
      expect(STORED_SUBSCRIPTION_STATUSES).toContain(update.mock.calls[0][0].status)
    })
  })

  // A database error is not "nothing to record": the handler answers 500 so Stripe sends the
  // event again. An event that matches no row or user is still 200 (the tests above).
  describe('a database error answers 500', () => {
    it.each([
      ['customer.subscription.deleted', { status: 'canceled', tier: 'free' }],
      ['invoice.payment_failed', { status: 'past_due' }],
    ])('%s: the update by subscription id fails', async (type, changes) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update, updateEq } = mockTables({
        matchedRows: [{ id: 'sub_test123' }],
        updateError: { code: '08006', message: 'connection failure', details: 'row-detail-marker' },
      })
      if (type === 'invoice.payment_failed') {
        mockConstructEvent.mockReturnValue(paymentFailedEvent())
        stripeNowHas({ status: 'past_due' })
      } else {
        mockConstructEvent.mockReturnValue(subscriptionEvent(type, { status: 'canceled' }))
      }

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(update).toHaveBeenCalledWith(changes)
      expect(updateEq).toHaveBeenCalledWith('id', 'sub_test123')
      // Not reported as an event that matched no row.
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        [`Stripe webhook: ${type} update failed (subscription sub_test123, code 08006): connection failure`],
      ])
      const logged = JSON.stringify(errorSpy.mock.calls)
      expect(logged).not.toContain('row-detail-marker')
      expect(logged).not.toContain('cus_test123')
    })

    it('customer.subscription.deleted delivered again after a 500 ends the same row', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue(
        subscriptionEvent('customer.subscription.deleted', { status: 'canceled' })
      )

      const failing = mockTables({ updateError: { code: '08006', message: 'connection failure' } })
      const first = await POST(makeRequest('{}'))
      const working = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      const second = await POST(makeRequest('{}'))

      expect(first.status).toBe(500)
      expect(second.status).toBe(200)
      expect(working.update.mock.calls).toEqual(failing.update.mock.calls)
      expect(working.updateEq.mock.calls).toEqual(failing.updateEq.mock.calls)
    })

    it('checkout.session.completed: the upsert fails, and no purchase is reported to analytics', async () => {
      process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = 'G-TEST123'
      process.env.GA_API_SECRET = 'secret_test'
      const fetchMock = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', fetchMock)

      try {
        const { POST } = await import('@/app/api/webhooks/stripe/route')
        mockTables()
        mockSubscriptionsRetrieve.mockResolvedValue(makeSubscription({ metadata: { user_id: USER_A } }))
        mockUpsert.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } })
        mockConstructEvent.mockReturnValue(checkoutEvent())

        const res = await POST(makeRequest('{}'))

        expect(res.status).toBe(500)
        expect(fetchMock).not.toHaveBeenCalled()
        expect(errorSpy.mock.calls).toEqual([
          ['Stripe webhook: checkout.session.completed upsert failed (subscription sub_test123, code 08006): connection failure'],
        ])
      } finally {
        vi.unstubAllGlobals()
        delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
        delete process.env.GA_API_SECRET
      }
    })

    it('checkout.session.completed: the profile lookup by customer fails', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ profileLookupErrors: { stripe_customer_id: { code: '57014' } } })
      mockSubscriptionsRetrieve.mockResolvedValue(makeSubscription({ metadata: {} }))
      mockConstructEvent.mockReturnValue(checkoutEvent())

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: checkout.session.completed profile lookup failed (subscription sub_test123, code 57014)'],
      ])
    })

    it('checkout.session.completed: no profile for the customer is still 200 with nothing written', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables()
      mockSubscriptionsRetrieve.mockResolvedValue(makeSubscription({ metadata: {} }))
      mockConstructEvent.mockReturnValue(checkoutEvent())

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('checkout.session.completed: the customer id cannot be saved on the profile, after the plan is written', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { profileUpdate } = mockTables({
        profileUpdateError: { code: '08006', message: 'connection failure' },
      })
      mockSubscriptionsRetrieve.mockResolvedValue(makeSubscription({ metadata: { user_id: USER_A } }))
      mockConstructEvent.mockReturnValue(checkoutEvent())

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(500)
      expect(profileUpdate).toHaveBeenCalledWith({ stripe_customer_id: 'cus_test123' })
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_test123', user_id: USER_A, tier: 'pro', status: 'active' }),
        { onConflict: 'user_id' }
      )
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: checkout.session.completed profile customer id update failed (subscription sub_test123, code 08006): connection failure'],
      ])
    })

    it('a credit pack: an insert error other than a duplicate, then the grant on redelivery', async () => {
      const mockInsert = vi
        .fn()
        .mockResolvedValueOnce({
          error: { code: '08006', message: 'connection failure', details: 'row-detail-marker' },
        })
        .mockResolvedValueOnce({ error: null })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'ai_credit_purchases') return { insert: mockInsert }
        return { upsert: mockUpsert }
      })
      mockListLineItems.mockResolvedValue({ data: [{ quantity: 500 }] })

      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_pack',
            mode: 'payment',
            customer: 'cus_test123',
            metadata: { user_id: USER_A, type: 'ai_credit_pack' },
          },
        },
      })

      const first = await POST(makeRequest('{}'))
      const second = await POST(makeRequest('{}'))

      expect(first.status).toBe(500)
      expect(second.status).toBe(200)
      // Both deliveries insert the same grant under the same session id.
      expect(mockInsert).toHaveBeenCalledTimes(2)
      expect(mockInsert.mock.calls[1][0]).toEqual(mockInsert.mock.calls[0][0])
      expect(mockInsert.mock.calls[0][0]).toMatchObject({ credits: 500, stripe_checkout_session_id: 'cs_pack' })
      expect(errorSpy.mock.calls).toEqual([
        ['Stripe webhook: checkout.session.completed credit pack insert failed (session cs_pack, code 08006): connection failure'],
      ])
      const logged = JSON.stringify(errorSpy.mock.calls)
      expect(logged).not.toContain('row-detail-marker')
      expect(logged).not.toContain(USER_A)
    })

    it('a credit pack that was already granted (duplicate session id) is still 200', async () => {
      const mockInsert = vi
        .fn()
        .mockResolvedValue({ error: { code: '23505', message: 'duplicate key value' } })
      mockFrom.mockImplementation((table: string) => {
        if (table === 'ai_credit_purchases') return { insert: mockInsert }
        return { upsert: mockUpsert }
      })
      mockListLineItems.mockResolvedValue({ data: [{ quantity: 500 }] })

      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockConstructEvent.mockReturnValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_pack',
            mode: 'payment',
            customer: 'cus_test123',
            metadata: { user_id: USER_A, type: 'ai_credit_pack' },
          },
        },
      })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  describe('invoice.payment_failed', () => {
    it.each([
      ['parent.subscription_details.subscription', { parent: { subscription_details: { subscription: 'sub_invoice1' } } }],
      ['parent.subscription_details.subscription (expanded)', { parent: { subscription_details: { subscription: { id: 'sub_invoice1' } } } }],
      ['a top-level subscription', { subscription: 'sub_invoice1' }],
    ])('marks the row stored under the invoice subscription id (%s), with no profile lookup', async (_label, invoiceFields) => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update, updateEq, profileEq } = mockTables({ matchedRows: [{ id: 'sub_invoice1' }] })
      mockConstructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_test123', customer: 'cus_test123', ...invoiceFields } },
      })
      stripeNowHas({ id: 'sub_invoice1', status: 'past_due' })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_invoice1')
      expect(update).toHaveBeenCalledWith({ status: 'past_due' })
      expect(updateEq).toHaveBeenCalledWith('id', 'sub_invoice1')
      expect(updateEq).not.toHaveBeenCalledWith('user_id', expect.anything())
      expect(profileEq).not.toHaveBeenCalled()
    })

    it('returns 200 and logs when no row has the invoice subscription id', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      mockTables({ matchedRows: [] })
      mockConstructEvent.mockReturnValue(paymentFailedEvent('sub_invoice1'))
      stripeNowHas({ id: 'sub_invoice1', status: 'incomplete' })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([
        ['Stripe webhook: invoice.payment_failed matched no subscription row or user (subscription sub_invoice1)'],
      ])
    })

    it('an invoice that bills no subscription writes nothing', async () => {
      const { POST } = await import('@/app/api/webhooks/stripe/route')
      const { update } = mockTables({ matchedRows: [{ id: 'sub_test123' }] })
      mockConstructEvent.mockReturnValue({
        type: 'invoice.payment_failed',
        data: { object: { id: 'in_test123', customer: 'cus_test123', parent: null } },
      })

      const res = await POST(makeRequest('{}'))

      expect(res.status).toBe(200)
      expect(update).not.toHaveBeenCalled()
      expect(mockUpsert).not.toHaveBeenCalled()
      expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
      expect(warnSpy.mock.calls).toEqual([
        ['Stripe webhook: invoice.payment_failed matched no subscription row or user (subscription none)'],
      ])
    })
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
