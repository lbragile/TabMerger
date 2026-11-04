/**
 * POST /api/billing/keep-current-plan (app/api/billing/keep-current-plan/route.ts) together with
 * keepCurrentPlan() in lib/stripe.ts: the account page's "Keep my current plan", which undoes a
 * scheduled plan change by releasing its subscription schedule. Only the caller's own subscription
 * and the schedule Stripe reports on it are ever touched, and the release is the only Stripe write.
 * Shapes follow the schedules Stripe made in test mode (the portal's and the server's: the current
 * phase to the period end, then the target price for one second). The Stripe SDK and Supabase are
 * mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { SAME_ORIGIN_HEADERS } from './helpers/billingRequest'
// The per-user billing limit is tested in rateLimit.test.ts and billingRequestGuard.test.ts; here
// it always allows, so these tests need no limiter RPC on their Supabase mock.
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  takeRateLimit: vi.fn(async () => ({ kind: 'allowed' })),
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
const mockScheduleRelease = vi.fn()
// A read: the next invoice, previewed after the release for the success message's amount.
const mockInvoicePreview = vi.fn()
// Every other write Stripe offers on the objects involved: none may be called.
const otherWrites = {
  subscriptionsUpdate: vi.fn(),
  subscriptionsCancel: vi.fn(),
  scheduleUpdate: vi.fn(),
  scheduleCancel: vi.fn(),
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
      update: otherWrites.subscriptionsUpdate,
      cancel: otherWrites.subscriptionsCancel,
    }
    subscriptionSchedules = {
      release: mockScheduleRelease,
      update: otherWrites.scheduleUpdate,
      cancel: otherWrites.scheduleCancel,
      create: otherWrites.scheduleCreate,
    }
    invoices = { create: otherWrites.invoicesCreate, createPreview: mockInvoicePreview }
    invoiceItems = { create: otherWrites.invoiceItemsCreate }
    customers = { createBalanceTransaction: otherWrites.balanceTransaction }
    creditNotes = { create: otherWrites.creditNotesCreate }
    refunds = { create: otherWrites.refundsCreate }
    billingPortal = { sessions: { create: otherWrites.portalSessionsCreate } }
  },
}))

const END = 1_795_757_962
const START = END - 2_678_400

const schedule = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_sched_mine',
  object: 'subscription_schedule',
  status: 'active',
  customer: 'cus_mine',
  subscription: 'sub_mine',
  end_behavior: 'release',
  current_phase: { start_date: START, end_date: END },
  phases: [
    { start_date: START, end_date: END, items: [{ price: 'price_ai_m' }] },
    { start_date: END, end_date: END + 1, items: [{ price: 'price_pro_m' }] },
  ],
  ...overrides,
})

const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_mine',
  customer: 'cus_mine',
  status: 'active',
  schedule: schedule(),
  items: { data: [{ id: 'si_1', price: { id: 'price_ai_m' }, current_period_end: END }] },
  ...overrides,
})

const request = (body?: unknown) =>
  new NextRequest('http://localhost/api/billing/keep-current-plan', {
    method: 'POST',
    headers: SAME_ORIGIN_HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

async function post(body?: unknown) {
  const { POST } = await import('@/app/api/billing/keep-current-plan/route')
  return POST(request(body))
}

const expectNoOtherWrites = () => {
  for (const [name, fn] of Object.entries(otherWrites)) {
    expect(fn, name).not.toHaveBeenCalled()
  }
  expect(dbWrites).not.toHaveBeenCalled()
}

describe('POST /api/billing/keep-current-plan', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    eqCalls.length = 0
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: 'cus_mine' } })
    mockRow.mockResolvedValue({ data: { id: 'sub_mine' } })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription())
    mockScheduleRelease.mockResolvedValue({ id: 'sub_sched_mine', status: 'released' })
    // Pro AI monthly with a 10% coupon: $7.19 due at renewal.
    mockInvoicePreview.mockResolvedValue({ amount_due: 719, total: 719, currency: 'usd' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('401 when signed out, touching nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await post()
    expect(res.status).toBe(401)
    expect(mockProfile).not.toHaveBeenCalled()
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })

  it("releases the schedule on the caller's own subscription, re-read from Stripe, and nothing else", async () => {
    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      renewal: { at: new Date(END * 1000).toISOString(), amount: 7.19, currency: 'USD' },
    })
    // The profile and the row are both read for the signed-in user only.
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['profiles', 'id', 'user-1'],
        ['subscriptions', 'user_id', 'user-1'],
      ])
    )
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_mine', { expand: ['schedule'] })
    // No parameters: Stripe's default keeps the subscription exactly as it is.
    expect(mockScheduleRelease.mock.calls).toEqual([['sub_sched_mine']])
    expectNoOtherWrites()
  })

  it('previews the renewal invoice after the release, for this customer and subscription only', async () => {
    await post()
    expect(mockInvoicePreview.mock.calls).toEqual([[{ customer: 'cus_mine', subscription: 'sub_mine' }]])
    expect(mockInvoicePreview.mock.invocationCallOrder[0]).toBeGreaterThan(mockScheduleRelease.mock.invocationCallOrder[0])
  })

  it('gives the amount in major units for a zero-decimal currency', async () => {
    mockInvoicePreview.mockResolvedValue({ amount_due: 1200, total: 1200, currency: 'jpy' })
    const body = await (await post()).json()
    expect(body.renewal).toEqual({ at: new Date(END * 1000).toISOString(), amount: 1200, currency: 'JPY' })
  })

  it('still keeps the plan when the preview fails: the date only, and one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockInvoicePreview.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError', requestId: 'req_9' }))

    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, renewal: { at: new Date(END * 1000).toISOString() } })
    expect(mockScheduleRelease).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls).toEqual([
      [
        'Keep current plan: previewing the renewal invoice of subscription sub_mine failed, so only its date is shown: StripeAPIError, request req_9: Server error',
      ],
    ])
  })

  it('returns no renewal (and previews nothing) when the subscription is set to end', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ cancel_at_period_end: true }))
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockInvoicePreview).not.toHaveBeenCalled()
  })

  it('403 forbidden_origin for a post from another site or subdomain, before reading the session', async () => {
    const { POST } = await import('@/app/api/billing/keep-current-plan/route')
    const cases: Array<Record<string, string>> = [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, {}]
    for (const headers of cases) {
      const res = await POST(new NextRequest('http://localhost/api/billing/keep-current-plan', { method: 'POST', headers }))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'forbidden_origin', code: 'forbidden_origin' })
    }
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })

  it('429 rate_limited with Retry-After past the billing limit, before any read or Stripe call', async () => {
    const { takeRateLimit } = await import('@/lib/rateLimit')
    vi.mocked(takeRateLimit).mockResolvedValueOnce({ kind: 'limited', retryAfterSeconds: 42 })

    const res = await post()

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(await res.json()).toEqual({ error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 42 })
    expect(vi.mocked(takeRateLimit).mock.calls[0][1]).toBe('user-1')
    expect(mockProfile).not.toHaveBeenCalled()
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })

  it('releases a server-made schedule too (a not_started one is still pending)', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ schedule: schedule({ id: 'sub_sched_server', status: 'not_started' }) })
    )
    const res = await post()
    expect(res.status).toBe(200)
    expect(mockScheduleRelease.mock.calls).toEqual([['sub_sched_server']])
  })

  it('ignores ids sent in the body: only the stored subscription and its own schedule are used', async () => {
    await post({ subscriptionId: 'sub_other', scheduleId: 'sub_sched_other' })
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_mine', { expand: ['schedule'] })
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalledWith('sub_other', expect.anything())
    expect(mockScheduleRelease.mock.calls).toEqual([['sub_sched_mine']])
  })

  it("404 no_subscription for another customer's subscription: nothing is released", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRow.mockResolvedValue({ data: { id: 'sub_other' } })
    mockSubscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ id: 'sub_other', customer: 'cus_other', schedule: schedule({ customer: 'cus_other', subscription: 'sub_other' }) })
    )

    const res = await post()

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(mockScheduleRelease).not.toHaveBeenCalled()
    expectNoOtherWrites()
  })

  it.each([
    ['names a different subscription', { subscription: 'sub_other' }],
    ['names a different customer', { customer: 'cus_other' }],
  ])('409 no_scheduled_change, nothing released, when the attached schedule %s', async (_label, overrides) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: schedule({ id: 'sub_sched_other', ...overrides }) }))

    const res = await post()

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('no_scheduled_change')
    expect(mockScheduleRelease).not.toHaveBeenCalled()
    expect(warn.mock.calls).toEqual([
      ['Keep current plan: schedule sub_sched_other on subscription sub_mine names another subscription or customer, so it is not released'],
    ])
  })

  it('404 no_subscription when Stripe has no such subscription (resource_missing)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }))
    const res = await post()
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })

  it('404 no_subscription when the account has no stored subscription', async () => {
    mockRow.mockResolvedValue({ data: null })
    const res = await post()
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it('400 no_billing_account without a Stripe customer', async () => {
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: null } })
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_billing_account')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it('400 no_billing_account when the profile row is missing (PGRST116 from .single())', async () => {
    mockProfile.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_billing_account')
  })

  // A failed read says nothing about whether the account has a billing account or a subscription,
  // so it is a server failure, never 400 or 404.
  it.each([
    ['the profile read', () => mockProfile.mockResolvedValue({ data: null, error: { code: '57014', message: 'statement timeout' } }), 'Keep current plan: reading the profile failed (code 57014)'],
    ['the subscription read', () => mockRow.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal error user-1' } }), 'Keep current plan: reading the subscription failed (code XX000)'],
    ['a read that throws', () => mockRow.mockRejectedValue(new Error('fetch failed for user-1')), 'Keep current plan: reading the profile and subscription failed (code unknown)'],
  ])('500 keep_plan_failed when %s fails, logged as one line with the code only', async (_label, arrange, line) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    arrange()

    const res = await post()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to keep the current plan', code: 'keep_plan_failed' })
    expect(error.mock.calls).toEqual([[line]])
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })

  it.each([
    ['no schedule', { schedule: null }],
    ['a released schedule (a second click)', { schedule: schedule({ status: 'released' }) }],
    ['a completed schedule', { schedule: schedule({ status: 'completed' }) }],
    [
      'a next phase on the current price',
      {
        schedule: schedule({
          phases: [schedule().phases[0], { start_date: END, end_date: END + 1, items: [{ price: 'price_ai_m' }] }],
        }),
      },
    ],
    ['a change that has already landed (in its one-second phase)', {
      items: { data: [{ id: 'si_1', price: { id: 'price_pro_m' }, current_period_end: END + 2_592_000 }] },
      schedule: schedule({ current_phase: { start_date: END, end_date: END + 1 } }),
    }],
  ])('409 no_scheduled_change for %s: nothing released', async (_label, overrides) => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription(overrides))

    const res = await post()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'No plan change is scheduled.', code: 'no_scheduled_change' })
    expect(mockScheduleRelease).not.toHaveBeenCalled()
    expectNoOtherWrites()
  })

  it('409 no_scheduled_change when the release fails because the schedule was released meanwhile', async () => {
    mockScheduleRelease.mockRejectedValue(
      Object.assign(new Error('You cannot release a subscription schedule that is currently in the `released` status.'), {
        type: 'StripeInvalidRequestError',
      })
    )
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(stripeSubscription())
      .mockResolvedValueOnce(stripeSubscription({ schedule: null }))

    const res = await post()

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('no_scheduled_change')
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(2)
  })

  it('500 keep_plan_failed when the release fails and the change is still scheduled, logged as one line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockScheduleRelease.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError', requestId: 'req_1' }))

    const res = await post()

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('keep_plan_failed')
    expect(error.mock.calls).toEqual([['Keep current plan: releasing the schedule failed: StripeAPIError, request req_1: Server error']])
    expectNoOtherWrites()
  })

  it('500 keep_plan_failed when the release fails and the re-read fails too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockScheduleRelease.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError' }))
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(stripeSubscription())
      .mockRejectedValueOnce(Object.assign(new Error('Server error'), { type: 'StripeAPIError' }))

    const res = await post()

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('keep_plan_failed')
  })

  it('500 keep_plan_failed when reading the subscription from Stripe fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError' }))
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('keep_plan_failed')
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })

  it('500 keep_plan_failed without calling Stripe when Stripe is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('keep_plan_failed')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockScheduleRelease).not.toHaveBeenCalled()
  })
})
