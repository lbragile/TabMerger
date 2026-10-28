/**
 * POST /api/billing/cancel-subscription (app/api/billing/cancel-subscription/route.ts) together
 * with createCancelSubscriptionSession() in lib/stripe.ts: the account page's "Cancel subscription"
 * while a plan change is scheduled. It opens Stripe's own cancel page (a `subscription_cancel` portal
 * flow) on an explicit configuration that cancels at the period end with no proration, and only for
 * the caller's own subscription. The Stripe SDK and Supabase are mocked.
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
      }
      return chain
    },
  })),
}))

const mockSubscriptionsRetrieve = vi.fn()
const mockSubscriptionsUpdate = vi.fn()
const mockScheduleRelease = vi.fn()
const mockPortalCreate = vi.fn()
const mockConfigList = vi.fn()
const mockConfigCreate = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { retrieve: mockSubscriptionsRetrieve, update: mockSubscriptionsUpdate }
    subscriptionSchedules = { release: mockScheduleRelease }
    billingPortal = {
      sessions: { create: mockPortalCreate },
      configurations: { list: mockConfigList, create: mockConfigCreate },
    }
  },
}))

const request = (body?: unknown) =>
  new NextRequest('http://localhost/api/billing/cancel-subscription', {
    method: 'POST',
    headers: SAME_ORIGIN_HEADERS,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

const stripeSubscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_mine',
  customer: 'cus_mine',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  schedule: 'sub_sched_1',
  items: { data: [{ id: 'si_1', price: { id: 'price_ai_m' } }] },
  ...overrides,
})

/** A portal configuration as Stripe lists it, with the cancellation features we make; overrides per feature. */
const cancelConfig = (
  id: string,
  cancel: Record<string, unknown> = {},
  update: Record<string, unknown> = {},
  metadata: Record<string, string> = { tabmerger_cancel: 'v1' }
) => ({
  id,
  metadata,
  features: {
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', ...cancel },
    subscription_update: { enabled: false, default_allowed_updates: [], proration_behavior: 'none', products: [], ...update },
  },
})

async function post(body?: unknown) {
  const { POST } = await import('@/app/api/billing/cancel-subscription/route')
  return POST(request(body))
}

describe('POST /api/billing/cancel-subscription', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    eqCalls.length = 0
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: 'cus_mine' } })
    mockRow.mockResolvedValue({ data: { id: 'sub_mine' } })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription())
    mockConfigList.mockResolvedValue({ data: [] })
    mockConfigCreate.mockResolvedValue({ id: 'bpc_cancel' })
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/cancel' })
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
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it("opens Stripe's cancel page for the caller's own subscription, on a cancel-at-period-end configuration", async () => {
    const res = await post()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://billing.stripe.com/p/session/cancel' })
    // The profile and the row are both read for the signed-in user only.
    expect(eqCalls).toEqual(
      expect.arrayContaining([
        ['profiles', 'id', 'user-1'],
        ['subscriptions', 'user_id', 'user-1'],
      ])
    )
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_mine')
    expect(mockConfigCreate).toHaveBeenCalledWith({
      name: 'TabMerger cancellation (v1)',
      metadata: { tabmerger_cancel: 'v1' },
      features: {
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
        subscription_update: { enabled: false },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
    })
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_mine',
      return_url: 'https://tabmerger.app/account',
      locale: 'en-CA',
      configuration: 'bpc_cancel',
      flow_data: {
        type: 'subscription_cancel',
        subscription_cancel: { subscription: 'sub_mine' },
        after_completion: { type: 'redirect', redirect: { return_url: 'https://tabmerger.app/account' } },
      },
    })
    // Stripe's page does the release and the cancellation; the server changes nothing itself.
    expect(mockScheduleRelease).not.toHaveBeenCalled()
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
  })

  it('reuses a configuration found by its metadata, then from memory', async () => {
    mockConfigList.mockResolvedValue({
      data: [
        cancelConfig('bpc_plan', {}, {}, { tabmerger_plan_change: 'v3:price_pro_m' }),
        cancelConfig('bpc_found'),
      ],
    })
    const { POST } = await import('@/app/api/billing/cancel-subscription/route')
    await POST(request())
    await POST(request())

    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockConfigList).toHaveBeenCalledTimes(1)
    expect(mockConfigList).toHaveBeenCalledWith({
      active: true,
      is_default: false,
      limit: 100,
      expand: ['data.features.subscription_update.products'],
    })
    expect(mockPortalCreate).toHaveBeenLastCalledWith(expect.objectContaining({ configuration: 'bpc_found' }))
  })

  it('pages through the whole configuration list to find it', async () => {
    mockConfigList
      .mockResolvedValueOnce({ data: [cancelConfig('bpc_plan', {}, {}, { tabmerger_plan_change: 'v3:price_pro_m' })], has_more: true })
      .mockResolvedValueOnce({ data: [cancelConfig('bpc_page2')], has_more: false })

    const res = await post()

    expect(res.status).toBe(200)
    expect(mockConfigList).toHaveBeenCalledTimes(2)
    expect(mockConfigList.mock.calls[1][0]).toMatchObject({ starting_after: 'bpc_plan' })
    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_page2' }))
  })

  // One edited in the Dashboard could cancel at once with a refund or credit, or allow plan
  // switches; it is skipped (logged by id) and a new configuration is made.
  it.each([
    ['immediate cancellation', { mode: 'immediately' }, {}],
    ['cancellation with proration', { mode: 'immediately', proration_behavior: 'create_prorations' }, {}],
    ['proration with at_period_end', { proration_behavior: 'create_prorations' }, {}],
    ['cancellation turned off', { enabled: false }, {}],
    ['plan switching turned on', {}, { enabled: true }],
  ])('a v1 cancellation configuration with %s is not reused: a new one is made', async (_label, cancel, update) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockConfigList.mockResolvedValue({ data: [cancelConfig('bpc_edited', cancel, update)] })

    const res = await post()

    expect(res.status).toBe(200)
    expect(mockConfigCreate).toHaveBeenCalledTimes(1)
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_cancel' }))
    expect(warn.mock.calls).toEqual([
      ['Billing portal: configuration bpc_edited (cancellation) has the expected metadata but different features, so it is not used and a new one is made'],
    ])
  })

  it("404 for another customer's subscription: no session is opened", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRow.mockResolvedValue({ data: { id: 'sub_other' } })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ id: 'sub_other', customer: 'cus_other' }))

    const res = await post()

    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('no_subscription')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('ignores a subscription id sent in the body: only the stored one is used', async () => {
    await post({ subscriptionId: 'sub_other' })
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_mine')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalledWith('sub_other')
  })

  it('404 when Stripe has no such subscription (resource_missing)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }))
    const res = await post()
    expect(res.status).toBe(404)
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('404 when the account has no stored subscription', async () => {
    mockRow.mockResolvedValue({ data: null })
    const res = await post()
    expect(res.status).toBe(404)
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
  })

  it('400 no_billing_account without a Stripe customer', async () => {
    mockProfile.mockResolvedValue({ data: { stripe_customer_id: null } })
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_billing_account')
  })

  it('400 no_billing_account when the profile row is missing (PGRST116 from .single())', async () => {
    mockProfile.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_billing_account')
  })

  // A failed read says nothing about whether the account has a billing account or a subscription,
  // so it is a server failure, never 400 no_billing_account or 404 no_subscription.
  it.each([
    ['the profile read', () => mockProfile.mockResolvedValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }), 'Cancel subscription: reading the profile failed (code 57014)'],
    ['the subscription read', () => mockRow.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal error user-1' } }), 'Cancel subscription: reading the subscription failed (code XX000)'],
    ['a read that throws', () => mockRow.mockRejectedValue(new Error('fetch failed for user-1')), 'Cancel subscription: reading the profile and subscription failed (code unknown)'],
  ])('500 cancel_failed when %s fails, logged as one line with the code only', async (_label, arrange, line) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    arrange()

    const res = await post()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to open the cancellation page', code: 'cancel_failed' })
    expect(error.mock.calls).toEqual([[line]])
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('409 already_canceling when the plan is already set to end (asking twice is harmless)', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ cancel_at_period_end: true, schedule: null }))
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_canceling')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('409 not_entitled for a subscription that has ended', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'canceled' }))
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_entitled')
  })

  it('still opens the page when the schedule has already been released', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: null }))
    const res = await post()
    expect(res.status).toBe(200)
  })

  it('500 cancel_failed when Stripe fails, logged as one line without the error object', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPortalCreate.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError', requestId: 'req_1' }))
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('cancel_failed')
    expect(error.mock.calls).toEqual([
      ['Cancel subscription: opening the cancel flow failed: StripeAPIError, request req_1: Server error'],
    ])
  })
})
