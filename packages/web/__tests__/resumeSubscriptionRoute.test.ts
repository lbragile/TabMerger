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
  billing_cycle_anchor: START,
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

  // Stripe counts each period from the billing anchor's day of the month, clamped to the month's
  // length: an anchor on the 31st gives Jan 31 -> Feb 28 -> Mar 31. `cancel_at` = the natural period
  // end is a full period (the portal's cancel); a day earlier is a Dashboard cut (`ends_early`),
  // which Stripe shows by moving current_period_end to it and leaving the anchor alone.
  const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 5, 27, 17) / 1000
  const periodOf = (
    anchor: number | null,
    start: number,
    end: number,
    interval: 'month' | 'year' = 'month',
    extra: Record<string, unknown> = {}
  ) =>
    stripeSubscription({
      billing_cycle_anchor: anchor,
      cancel_at: end,
      items: {
        data: [{ id: 'si_1', price: { id: 'p', recurring: { interval, interval_count: 1 } }, current_period_start: start, current_period_end: end }],
      },
      ...extra,
    })

  it.each([
    ['anchor on the 31st, into a shorter month (Jan 31 to Feb 28)', utc(2027, 1, 31), utc(2027, 1, 31), utc(2027, 2, 28), 'month'],
    ['anchor on the 31st, across February (Feb 28 to Mar 31)', utc(2027, 1, 31), utc(2027, 2, 28), utc(2027, 3, 31), 'month'],
    ['anchor on the 30th, across February (Feb 28 to Mar 30)', utc(2027, 1, 30), utc(2027, 2, 28), utc(2027, 3, 30), 'month'],
    ['anchor on the 29th, in a leap February (Feb 29 to Mar 29, 2028)', utc(2028, 1, 29), utc(2028, 2, 29), utc(2028, 3, 29), 'month'],
    ['anchor on the 29th, across a common February (Feb 28 to Mar 29, 2027)', utc(2027, 1, 29), utc(2027, 2, 28), utc(2027, 3, 29), 'month'],
    ['a yearly anchor on Feb 29, into a leap year (2031-02-28 to 2032-02-29)', utc(2028, 2, 29), utc(2031, 2, 28), utc(2032, 2, 29), 'year'],
    ['a mid-month anchor (Mar 15 to Apr 15)', utc(2027, 1, 15), utc(2027, 3, 15), utc(2027, 4, 15), 'month'],
  ] as const)('%s: a cancellation at the period end is a full period and is resumed', async (_label, anchor, start, end, interval) => {
    mockSubscriptionsRetrieve.mockResolvedValue(periodOf(anchor, start, end, interval))
    const res = await post()
    expect(res.status).toBe(200)
    expect(mockSubscriptionsUpdate).toHaveBeenCalledTimes(1)
  })

  it.each([
    // Counting from the start's own clamped day (the 28th) gave Mar 28 and missed these.
    ['anchor on the 31st: cut to Mar 30', utc(2027, 1, 31), utc(2027, 2, 28), utc(2027, 3, 30), 'month'],
    ['anchor on the 31st: cut to Mar 29', utc(2027, 1, 31), utc(2027, 2, 28), utc(2027, 3, 29), 'month'],
    ['anchor on the 30th: cut to Mar 29', utc(2027, 1, 30), utc(2027, 2, 28), utc(2027, 3, 29), 'month'],
    ['anchor on the 29th, common February: cut to Mar 28', utc(2027, 1, 29), utc(2027, 2, 28), utc(2027, 3, 28), 'month'],
    ['anchor on the 29th, leap February: cut to Mar 28', utc(2028, 1, 29), utc(2028, 2, 29), utc(2028, 3, 28), 'month'],
    ['a yearly anchor on Feb 29: cut to 2032-02-28', utc(2028, 2, 29), utc(2031, 2, 28), utc(2032, 2, 28), 'year'],
    ['a mid-month anchor: cut to Apr 5', utc(2027, 1, 15), utc(2027, 3, 15), utc(2027, 4, 5), 'month'],
    ['a mid-month anchor: cut by one day', utc(2027, 1, 15), utc(2027, 3, 15), utc(2027, 4, 14), 'month'],
  ] as const)('%s: 409 ends_early, nothing is updated', async (_label, anchor, start, end, interval) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockResolvedValue(periodOf(anchor, start, end, interval))
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('ends_early')
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it("an anchor after the period start is not one Stripe counts this period from: the start's own day is used", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // A first period up to a later custom anchor (never set by our Checkout) ending on the anchor:
    // counted from the start, the period looks cut, so it is left to support rather than resumed.
    const start = utc(2027, 3, 3)
    const anchor = utc(2027, 3, 20)
    mockSubscriptionsRetrieve.mockResolvedValue(periodOf(anchor, start, anchor))
    let res = await post()
    expect((await res.json()).code).toBe('ends_early')

    // A full month from the start is resumed whatever the later anchor's day.
    mockSubscriptionsRetrieve.mockResolvedValue(periodOf(utc(2027, 3, 31), start, utc(2027, 4, 3)))
    res = await post()
    expect(res.status).toBe(200)
  })

  it('without an anchor the period is counted from its start', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(periodOf(null, utc(2027, 3, 15), utc(2027, 4, 15)))
    expect((await post()).status).toBe(200)
  })

  it('409 schedule_attached when a subscription schedule is attached (a Dashboard-made one): nothing is updated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: 'sub_sched_dashboard' }))

    const res = await post()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'This plan has changes set up by support. Contact us to keep it.',
      code: 'schedule_attached',
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
    expectNoOtherWrites()
  })

  it('an expanded schedule object counts too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: { id: 'sub_sched_dashboard', status: 'active' } }))
    const res = await post()
    expect((await res.json()).code).toBe('schedule_attached')
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
