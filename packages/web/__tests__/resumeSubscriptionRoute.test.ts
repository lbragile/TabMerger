/**
 * POST /api/billing/resume-subscription (app/api/billing/resume-subscription/route.ts) together
 * with resumeSubscription() in lib/stripe.ts: the account page's "Keep my plan", which undoes a
 * cancellation at the end of the period. Only the caller's own subscription is touched, and one
 * `subscriptions.update` clearing `cancel_at` is the only Stripe write. Shapes follow what Stripe
 * returned in test mode (2026-11-02): the portal's cancel on flexible billing mode sets `cancel_at`
 * to the period end with `cancel_at_period_end` false; classic sets both. The Stripe SDK and
 * Supabase are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { SAME_ORIGIN_HEADERS } from './helpers/billingRequest'

const mockTakeRateLimit = vi.hoisted(() => vi.fn(async () => ({ kind: 'allowed' }) as { kind: string; retryAfterSeconds?: number }))
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  takeRateLimit: mockTakeRateLimit,
}))

const mockGetUser = vi.fn()
const mockProfile = vi.fn()
const mockRow = vi.fn()
const eqCalls: Array<[string, string, unknown]> = []
const dbWrites = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
  createServiceRoleClient: vi.fn(async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          eqCalls.push([table, column, value])
          return chain
        },
        order: () => chain,
        limit: () => chain,
        single: mockProfile,
        maybeSingle: mockRow,
        insert: dbWrites,
        update: dbWrites,
        upsert: dbWrites,
        delete: dbWrites,
      }
      return chain
    },
  })),
}))

const mockSubscriptionsRetrieve = vi.fn()
const mockSubscriptionsUpdate = vi.fn()
const mockInvoicePreview = vi.fn()
// Every other write Stripe offers on the objects involved: none may be called.
const otherWrites = {
  subscriptionsCancel: vi.fn(),
  subscriptionsResume: vi.fn(),
  scheduleRelease: vi.fn(),
  scheduleCreate: vi.fn(),
  invoicesCreate: vi.fn(),
  invoiceItemsCreate: vi.fn(),
  balanceTransaction: vi.fn(),
  creditNotesCreate: vi.fn(),
  refundsCreate: vi.fn(),
  portalSessionsCreate: vi.fn(),
}

vi.mock('stripe', () => ({
  default: class {
    subscriptions = {
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
      cancel: otherWrites.subscriptionsCancel,
      resume: otherWrites.subscriptionsResume,
    }
    subscriptionSchedules = { release: otherWrites.scheduleRelease, create: otherWrites.scheduleCreate }
    invoices = { create: otherWrites.invoicesCreate, createPreview: mockInvoicePreview }
    invoiceItems = { create: otherWrites.invoiceItemsCreate }
    customers = { createBalanceTransaction: otherWrites.balanceTransaction }
    creditNotes = { create: otherWrites.creditNotesCreate }
    refunds = { create: otherWrites.refundsCreate }
    billingPortal = { sessions: { create: otherWrites.portalSessionsCreate } }
  },
}))

// The monthly period of the test-mode subscription: 2026-10-26 to 2026-11-26 (UTC, 31 days).
const START = Date.UTC(2026, 9, 26, 5, 27, 17) / 1000
const END = Date.UTC(2026, 10, 26, 5, 27, 17) / 1000

const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_mine',
  customer: 'cus_mine',
  status: 'active',
  schedule: null,
  cancel_at: END,
  cancel_at_period_end: false,
  items: {
    data: [
      {
        id: 'si_1',
        price: { id: 'price_pro_m', recurring: { interval: 'month', interval_count: 1 } },
        current_period_start: START,
        current_period_end: END,
      },
    ],
  },
  ...overrides,
})

const request = (body?: unknown, headers: Record<string, string> = SAME_ORIGIN_HEADERS) =>
  new NextRequest('http://localhost/api/billing/resume-subscription', {
    method: 'POST',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

async function post(body?: unknown, headers?: Record<string, string>) {
  const { POST } = await import('@/app/api/billing/resume-subscription/route')
  return POST(request(body, headers))
}

const expectNoOtherWrites = () => {
  for (const [name, fn] of Object.entries(otherWrites)) {
    expect(fn, name).not.toHaveBeenCalled()
  }
  expect(dbWrites).not.toHaveBeenCalled()
}

describe('POST /api/billing/resume-subscription', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    eqCalls.length = 0
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    mockTakeRateLimit.mockResolvedValue({ kind: 'allowed' })
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: 'cus_mine' } })
    mockRow.mockResolvedValue({ data: { id: 'sub_mine' } })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription())
    mockSubscriptionsUpdate.mockResolvedValue(stripeSubscription({ cancel_at: null }))
    mockInvoicePreview.mockResolvedValue({ amount_due: 399, total: 399, currency: 'usd' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('401 when signed out, touching nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await post()
    expect(res.status).toBe(401)
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('403 forbidden_origin for a post from another site or subdomain, before reading the session', async () => {
    for (const site of ['cross-site', 'same-site']) {
      const res = await post(undefined, { 'sec-fetch-site': site })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin', code: 'forbidden_origin' })
    }
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('429 rate_limited with Retry-After past the billing limit, before any read or Stripe call', async () => {
    mockTakeRateLimit.mockResolvedValue({ kind: 'limited', retryAfterSeconds: 42 })
    const res = await post()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(mockProfile).not.toHaveBeenCalled()
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it("clears cancel_at on the caller's own subscription (the portal's flexible-mode cancel), and nothing else", async () => {
    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      renewal: { at: new Date(END * 1000).toISOString(), amount: 3.99, currency: 'USD' },
    })
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_mine')
    // One parameter: Stripe refuses cancel_at and cancel_at_period_end together.
    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1)
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_mine', { cancel_at: '', proration_behavior: 'none' })
    expect(mockInvoicePreview).toHaveBeenCalledWith({ customer: 'cus_mine', subscription: 'sub_mine' })
    // The ownership reads are keyed on the caller.
    expect(eqCalls).toEqual([
      ['profiles', 'id', 'user-1'],
      ['subscriptions', 'user_id', 'user-1'],
    ])
    expectNoOtherWrites()
  })

  it('clears a classic cancel_at_period_end the same way', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ cancel_at_period_end: true }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_mine', { cancel_at: '', proration_behavior: 'none' })
  })

  it('still keeps the plan when the renewal preview fails: the date only, and one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockInvoicePreview.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError' }))

    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, renewal: { at: new Date(END * 1000).toISOString() } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^Resume subscription: previewing the renewal invoice of subscription sub_mine failed/)
  })

  it('ignores ids sent in the body: only the stored subscription is used', async () => {
    await post({ subscriptionId: 'sub_someone_else', customerId: 'cus_someone_else' })
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_mine')
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_mine', expect.anything())
  })

  it("404 no_subscription for another customer's subscription: nothing is updated", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ customer: 'cus_other' }))

    const res = await post()

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
    expectNoOtherWrites()
  })

  it('404 no_subscription when Stripe has no such subscription (resource_missing)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }))
    const res = await post()
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('404 no_subscription when the account has no stored subscription', async () => {
    mockRow.mockResolvedValue({ data: null })
    const res = await post()
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it('400 no_billing_account without a Stripe customer, or with no profile row (PGRST116)', async () => {
    mockProfile.mockResolvedValueOnce({ data: { stripe_customer_id: null } })
    let res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_billing_account')

    mockProfile.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_billing_account')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it.each([
    ['the profile read', () => mockProfile.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } }), 'Resume subscription: reading the profile failed (code 57014)'],
    ['the subscription read', () => mockRow.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal error user-1' } }), 'Resume subscription: reading the subscription failed (code XX000)'],
    ['a read that throws', () => mockRow.mockRejectedValue(new Error('fetch failed for user-1')), 'Resume subscription: reading the profile and subscription failed (code unknown)'],
  ])('500 resume_failed when %s fails, logged as one line with the code only', async (_label, arrange, line) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    arrange()

    const res = await post()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to keep the plan', code: 'resume_failed' })
    expect(error.mock.calls).toEqual([[line]])
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it.each([['canceled'], ['incomplete_expired'], ['unpaid'], ['incomplete']])(
    '409 not_entitled for a %s subscription: nothing is updated',
    async (status) => {
      mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status }))
      const res = await post()
      expect(res.status).toBe(409)
      expect((await res.json()).code).toBe('not_entitled')
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
      expectNoOtherWrites()
    }
  )

  it('409 not_canceling when the plan is not set to end (already kept by an earlier click)', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ cancel_at: null, cancel_at_period_end: false }))
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Your plan is not set to end.', code: 'not_canceling' })
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('409 ends_early when a cancel date cut the period short: clearing it would give the time back unpaid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cut = START + 10 * 86_400
    mockSubscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({
        cancel_at: cut,
        items: {
          data: [
            {
              id: 'si_1',
              price: { id: 'price_pro_m', recurring: { interval: 'month', interval_count: 1 } },
              current_period_start: START,
              current_period_end: cut,
            },
          ],
        },
      })
    )

    const res = await post()

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ends_early')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it.each([
    ['a month ending on a shorter month (Jan 31 to Feb 28)', Date.UTC(2027, 0, 31) / 1000, Date.UTC(2027, 1, 28) / 1000, 'month'],
    ['a month starting on a clamped day (Feb 28 to Mar 31, anchor on the 31st)', Date.UTC(2027, 1, 28) / 1000, Date.UTC(2027, 2, 31) / 1000, 'month'],
    ['a leap-day year (2028-02-29 to 2029-02-28)', Date.UTC(2028, 1, 29) / 1000, Date.UTC(2029, 1, 28) / 1000, 'year'],
  ])('a cancellation at the end of %s is a full period, not ends_early', async (_label, start, end, interval) => {
    mockSubscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({
        cancel_at: end,
        items: {
          data: [{ id: 'si_1', price: { id: 'p', recurring: { interval, interval_count: 1 } }, current_period_start: start, current_period_end: end }],
        },
      })
    )
    const res = await post()
    expect(res.status).toBe(200)
  })

  it('409 not_canceling when the update fails because an earlier click already kept the plan', async () => {
    mockSubscriptionsUpdate.mockRejectedValue(Object.assign(new Error('conflict'), { type: 'StripeInvalidRequestError' }))
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(stripeSubscription())
      .mockResolvedValueOnce(stripeSubscription({ cancel_at: null }))

    const res = await post()

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_canceling')
  })

  it('409 not_entitled when the plan ended between the read and the update', async () => {
    mockSubscriptionsUpdate.mockRejectedValue(
      Object.assign(new Error('A canceled subscription can only update its cancellation_details and metadata.'), {
        type: 'StripeInvalidRequestError',
        code: 'invalid_canceled_subscription_fields',
      })
    )
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(stripeSubscription())
      .mockResolvedValueOnce(stripeSubscription({ status: 'canceled' }))

    const res = await post()

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_entitled')
  })

  it('500 resume_failed when the update fails and the plan is still set to end, logged as one line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSubscriptionsUpdate.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError', requestId: 'req_1' }))

    const res = await post()

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('resume_failed')
    expect(error.mock.calls).toEqual([['Resume subscription: clearing the cancellation failed: StripeAPIError, request req_1: Server error']])
    expectNoOtherWrites()
  })

  it('500 resume_failed when reading the subscription from Stripe fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError' }))
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('resume_failed')
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })
})
