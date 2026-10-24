/**
 * POST /api/checkout asks Stripe before selling a plan (lib/checkoutGuard.ts), and expires the
 * customer's other open subscription checkouts (lib/stripe.ts). The real route and libraries run
 * against a mocked Stripe SDK and an in-memory `subscriptions` row, so these tests see the
 * response, the row and the Stripe calls together.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'

type Row = { id: string; user_id: string; tier: string; status: string; [column: string]: unknown }

let row: Row
let profile: { stripe_customer_id: string | null }
let profileError: { code: string } | null = null
const updates: Array<{ changes: Record<string, unknown>; id: string }> = []
const upserts: Array<{ values: Record<string, unknown>; options: unknown }> = []
let upsertError: { code: string; message: string } | null = null

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => {
  const reader = (table: string) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.maybeSingle = async () => ({ data: table === 'subscriptions' ? { ...row } : null, error: null })
    q.single = async () =>
      table === 'profiles' && profileError
        ? { data: null, error: profileError }
        : { data: table === 'profiles' ? { ...profile } : null, error: null }
    return q
  }
  return {
    createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser }, from: reader })),
    createServiceRoleClient: vi.fn(async () => ({
      from: (table: string) => ({
        ...reader(table),
        // `.update(changes).eq('id', id).select('id')`: only the row stored under that id.
        update: (changes: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => ({
            select: async () => {
              updates.push({ changes, id })
              if (row.id !== id) return { data: [], error: null }
              row = { ...row, ...changes } as Row
              return { data: [{ id }], error: null }
            },
          }),
        }),
        upsert: async (values: Record<string, unknown>, options: unknown) => {
          upserts.push({ values, options })
          if (upsertError) return { error: upsertError }
          row = { ...row, ...values } as Row
          return { error: null }
        },
      }),
    })),
  }
})

const mockSubscriptionsList = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockSessionCreate = vi.fn()
const mockSessionList = vi.fn()
const mockSessionExpire = vi.fn()
const mockSessionRetrieve = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: mockSubscriptionsList, retrieve: mockSubscriptionsRetrieve }
    checkout = {
      sessions: {
        create: mockSessionCreate,
        list: mockSessionList,
        expire: mockSessionExpire,
        retrieve: mockSessionRetrieve,
      },
    }
    coupons = { retrieve: vi.fn() }
  },
}))

const stripeSub = (
  id: string,
  status: string,
  priceId: string,
  { customer = 'cus_1', userId }: { customer?: string; userId?: string } = {}
) => ({
  id,
  status,
  customer,
  cancel_at_period_end: false,
  metadata: userId ? { user_id: userId } : {},
  discounts: [],
  items: { data: [{ id: `si_${id}`, price: { id: priceId }, current_period_end: 1_800_000_000 }] },
})

const FREE_ROW: Row = { id: 'free_user-1', user_id: 'user-1', tier: 'free', status: 'active' }

async function checkout(body: unknown = { tier: 'pro', interval: 'monthly' }) {
  const { POST } = await import('@/app/api/checkout/route')
  return POST(new NextRequest('http://localhost/api/checkout', { method: 'POST', body: JSON.stringify(body) }))
}

let warn: MockInstance<typeof console.warn>
let error: MockInstance<typeof console.error>
const lines = (spy: MockInstance<typeof console.warn>) => spy.mock.calls.map((call) => String(call[0]))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  upserts.length = 0
  updates.length = 0
  upsertError = null
  profileError = null
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tabmerger.app')
  vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', 'false')
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
  vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_y')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
  row = { ...FREE_ROW }
  profile = { stripe_customer_id: 'cus_1' }
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mockSubscriptionsList.mockResolvedValue({ data: [], has_more: false })
  mockSessionCreate.mockResolvedValue({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' })
  mockSessionList.mockResolvedValue({ data: [], has_more: false })
  mockSessionExpire.mockResolvedValue({ status: 'expired' })
  mockSessionRetrieve.mockImplementation(async (id: string) => ({ id, status: 'expired', mode: 'subscription' }))
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  warn.mockRestore()
  error.mockRestore()
})

describe('a live subscription at Stripe', () => {
  it('refuses, and records it on a row that says free (the webhook write)', async () => {
    const live = stripeSub('sub_live', 'active', 'price_ai_y', { userId: 'user-1' })
    mockSubscriptionsList.mockResolvedValue({ data: [live], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(live)

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_subscribed', recorded: true })
    expect(mockSessionCreate).not.toHaveBeenCalled()
    // Read again by id (with what the AI allowance needs), then the webhook's user-keyed upsert,
    // then read once more to catch a plan that ended in between.
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_live', expect.objectContaining({ expand: expect.any(Array) }))
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledTimes(2)
    expect(updates).toEqual([])
    expect(upserts).toHaveLength(1)
    expect(upserts[0].options).toEqual({ onConflict: 'user_id' })
    expect(row).toMatchObject({
      id: 'sub_live',
      user_id: 'user-1',
      tier: 'pro_ai',
      status: 'active',
      stripe_price_id: 'price_ai_y',
    })
    expect(lines(warn)).toContain(
      'Checkout: refused and recorded a live subscription the row was missing (subscription sub_live: pro_ai/active)'
    )
  })

  it.each(['trialing', 'past_due'])('treats %s as live too', async (status) => {
    const live = stripeSub('sub_live', status, 'price_pro_m')
    mockSubscriptionsList.mockResolvedValue({ data: [live], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(live)

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(row).toMatchObject({ tier: 'pro', status })
  })

  it('refuses a live subscription on a price this deployment does not sell, without writing', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_legacy', 'active', 'price_legacy')], has_more: false })

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_subscribed', recorded: false })
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(upserts).toEqual([])
    expect(row).toEqual(FREE_ROW)
    expect(mockSessionCreate).not.toHaveBeenCalled()
    expect(lines(warn)).toEqual([
      "Checkout: refused; the customer has a live subscription on a price this deployment doesn't sell, not recorded (subscription sub_legacy)",
    ])
  })

  it.each([
    ['belongs to another customer', stripeSub('sub_live', 'active', 'price_pro_m', { customer: 'cus_other' }), 'other_customer'],
    ['names another user in its metadata', stripeSub('sub_live', 'active', 'price_pro_m', { userId: 'user-2' }), 'other_user'],
    ['is no longer live when read again', stripeSub('sub_live', 'canceled', 'price_pro_m'), 'not_entitled'],
  ])('refuses without writing when the subscription %s', async (_label, current, reason) => {
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_live', 'active', 'price_pro_m')], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(current)

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_subscribed', recorded: false })
    expect(upserts).toEqual([])
    expect(lines(warn)).toContain(
      `Checkout: refused; a live subscription was found but not recorded (subscription sub_live, ${reason})`
    )
  })

  it('still refuses when the write fails, logging one line', async () => {
    const live = stripeSub('sub_live', 'active', 'price_pro_m')
    mockSubscriptionsList.mockResolvedValue({ data: [live], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(live)
    upsertError = { code: '57014', message: 'canceling statement due to statement timeout' }

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_subscribed', recorded: false })
    expect(mockSessionCreate).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      'Checkout resync: upsert failed (subscription sub_live, code 57014): canceling statement due to statement timeout'
    )
  })
})

describe('a subscription that can still be paid or resumed', () => {
  it.each(['unpaid', 'paused', 'incomplete'])('%s: 409 pay_or_resume, nothing written or sold', async (status) => {
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_open', status, 'price_pro_m')], has_more: false })

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'pay_or_resume' })
    expect(upserts).toEqual([])
    expect(mockSessionCreate).not.toHaveBeenCalled()
  })
})

describe('nothing live or open', () => {
  it.each([
    ['no subscriptions (canceled ones are not listed)', []],
    ['only incomplete_expired', [stripeSub('sub_x', 'incomplete_expired', 'price_pro_m')]],
  ])('%s: sells, on the existing customer', async (_label, data) => {
    mockSubscriptionsList.mockResolvedValue({ data, has_more: false })

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_new' })
    expect(mockSubscriptionsList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 100 })
    expect(mockSessionCreate).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_1' }), expect.anything())
  })

  it('asks Stripe nothing for an account with no Stripe customer yet', async () => {
    profile = { stripe_customer_id: null }

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
    expect(mockSessionList).not.toHaveBeenCalled()
    const params = mockSessionCreate.mock.calls[0][0]
    expect(params).not.toHaveProperty('customer')
  })

  it('a customer Stripe does not have: sells without it, so Checkout makes a new customer', async () => {
    profile = { stripe_customer_id: 'cus_test_seeded' }
    mockSubscriptionsList.mockRejectedValue(
      Object.assign(new Error("No such customer: 'cus_test_seeded'"), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        param: 'customer',
        statusCode: 400,
      })
    )

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(mockSessionCreate.mock.calls[0][0]).not.toHaveProperty('customer')
    expect(mockSessionList).not.toHaveBeenCalled()
    expect(lines(warn)).toContain(
      'Checkout: Stripe has no customer for this account (resource_missing); checkout makes a new one'
    )
    expect(lines(warn).join('\n')).not.toContain('cus_test_seeded')
  })
})

describe('the list must be read in full', () => {
  it('pages through has_more and refuses a live subscription on a later page', async () => {
    const live = stripeSub('sub_live', 'active', 'price_pro_m')
    mockSubscriptionsList
      .mockResolvedValueOnce({ data: [stripeSub('sub_old', 'incomplete_expired', 'price_pro_m')], has_more: true })
      .mockResolvedValueOnce({ data: [live], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(live)

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(mockSubscriptionsList).toHaveBeenNthCalledWith(2, { customer: 'cus_1', limit: 100, starting_after: 'sub_old' })
    expect(mockSessionCreate).not.toHaveBeenCalled()
  })

  it('fails closed (503 billing_check_failed) past the page limit', async () => {
    mockSubscriptionsList.mockImplementation(async () => ({
      data: [stripeSub(`sub_${Math.random()}`, 'incomplete_expired', 'price_pro_m')],
      has_more: true,
    }))

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'billing_check_failed' })
    expect(mockSubscriptionsList).toHaveBeenCalledTimes(5)
    expect(mockSessionCreate).not.toHaveBeenCalled()
  })

  it('fails closed (503 billing_check_failed) when Stripe cannot be read, logging one line', async () => {
    mockSubscriptionsList.mockRejectedValue(
      Object.assign(new Error('Rate limited'), { type: 'StripeRateLimitError', statusCode: 429, requestId: 'req_1' })
    )

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'billing_check_failed' })
    expect(mockSessionCreate).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(
      "Checkout: reading the customer's subscriptions failed; nothing sold: StripeRateLimitError, status 429, request req_1: Rate limited"
    )
  })
})

describe('two tabs: only the newest subscription checkout stays open', () => {
  it('expires the customer’s other open subscription checkouts, not credit packs or the new one', async () => {
    mockSessionList.mockResolvedValue({
      data: [
        { id: 'cs_new', mode: 'subscription' },
        { id: 'cs_other_tab', mode: 'subscription' },
        { id: 'cs_credit_pack', mode: 'payment' },
      ],
      has_more: false,
    })

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(mockSessionList).toHaveBeenCalledWith({ customer: 'cus_1', status: 'open', limit: 100 })
    expect(mockSessionExpire).toHaveBeenCalledTimes(1)
    expect(mockSessionExpire).toHaveBeenCalledWith('cs_other_tab')
    // Expired after the new session exists, so a tab racing this one can't be the survivor.
    expect(mockSessionCreate.mock.invocationCallOrder[0]).toBeLessThan(mockSessionExpire.mock.invocationCallOrder[0])
  })

  it('a session that expired on its own just before: logged, read again, and the new checkout goes ahead', async () => {
    mockSessionList.mockResolvedValue({
      data: [
        { id: 'cs_paid_meanwhile', mode: 'subscription' },
        { id: 'cs_other_tab', mode: 'subscription' },
      ],
      has_more: false,
    })
    mockSessionExpire
      .mockRejectedValueOnce(
        Object.assign(new Error('Only Checkout Sessions with a status of open can be expired.'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        })
      )
      .mockResolvedValueOnce({ status: 'expired' })

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_new' })
    expect(mockSessionExpire).toHaveBeenCalledWith('cs_other_tab')
    expect(lines(warn)).toContain(
      'Checkout: expiring open session cs_paid_meanwhile failed: StripeInvalidRequestError, status 400: Only Checkout Sessions with a status of open can be expired.'
    )
  })

  it('a failed list of open sessions does not fail the new checkout', async () => {
    mockSessionList.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError', statusCode: 500 }))

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(mockSessionExpire).not.toHaveBeenCalled()
  })
})

describe('the AI flags are checked before Stripe', () => {
  it.each([
    ['managed Pro AI with the managed flag off', { tier: 'proAi', interval: 'monthly' }, 'false', 'true'],
    ['own-key Pro AI with both flags off', { tier: 'proAi', interval: 'monthly', aiMode: 'byok' }, 'false', 'false'],
  ])('%s: 503 ai_disabled, Stripe never asked', async (_label, body, managed, byok) => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', managed)
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', byok)
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_live', 'active', 'price_pro_m')], has_more: false })

    const res = await checkout(body)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_disabled' })
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
    expect(mockSessionCreate).not.toHaveBeenCalled()
  })
})

describe('fixes from the security review', () => {
  it('W1: a failed profile read is 503 billing_check_failed, before any Stripe call', async () => {
    profileError = { code: '57014' }

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'billing_check_failed' })
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
    expect(mockSessionCreate).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Checkout profile lookup error:', '57014')
  })

  it('W1: no profile row (PGRST116) still means "no customer yet" and sells', async () => {
    profileError = { code: 'PGRST116' }

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
    expect(mockSessionCreate.mock.calls[0][0]).not.toHaveProperty('customer')
  })

  it('W2: another tab paid meanwhile: the new session is withdrawn and the answer is 409, no URL', async () => {
    mockSessionList.mockResolvedValue({
      data: [
        { id: 'cs_new', mode: 'subscription' },
        { id: 'cs_credit_pack', mode: 'payment' },
        { id: 'cs_other_tab', mode: 'subscription' },
      ],
      has_more: false,
    })
    mockSessionExpire.mockImplementation(async (id: string) => {
      if (id === 'cs_other_tab') {
        throw Object.assign(new Error('Only Checkout Sessions with a status of open can be expired.'), {
          type: 'StripeInvalidRequestError',
          statusCode: 400,
        })
      }
      return { id, status: 'expired' }
    })
    mockSessionRetrieve.mockResolvedValue({ id: 'cs_other_tab', status: 'complete', mode: 'subscription' })

    const res = await checkout()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({ error: 'already_subscribed', recorded: false })
    expect(body).not.toHaveProperty('url')
    expect(mockSessionRetrieve).toHaveBeenCalledWith('cs_other_tab')
    expect(mockSessionExpire.mock.calls.map(([id]) => id)).toEqual(['cs_other_tab', 'cs_new'])
    // The credit-pack session is never expired or read.
    expect(mockSessionExpire).not.toHaveBeenCalledWith('cs_credit_pack')
    expect(mockSessionRetrieve).not.toHaveBeenCalledWith('cs_credit_pack')
    expect(lines(warn)).toContain(
      'Checkout: session cs_other_tab completed while a new checkout started; new session cs_new withdrawn'
    )
  })

  it('W2: still 409 with no URL when the new session cannot be expired either', async () => {
    mockSessionList.mockResolvedValue({ data: [{ id: 'cs_other_tab', mode: 'subscription' }], has_more: false })
    mockSessionExpire.mockRejectedValue(Object.assign(new Error('Server error'), { type: 'StripeAPIError', statusCode: 500 }))
    mockSessionRetrieve.mockResolvedValue({ id: 'cs_other_tab', status: 'complete', mode: 'subscription' })

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).not.toHaveProperty('url')
    expect(error).toHaveBeenCalledWith('Checkout: expiring new session cs_new failed: StripeAPIError, status 500: Server error')
  })

  it('W2: a completed payment-mode session does not withdraw the new checkout', async () => {
    mockSessionList.mockResolvedValue({ data: [{ id: 'cs_other_tab', mode: 'subscription' }], has_more: false })
    mockSessionExpire.mockRejectedValueOnce(Object.assign(new Error('Not open'), { type: 'StripeInvalidRequestError', statusCode: 400 }))
    mockSessionRetrieve.mockResolvedValue({ id: 'cs_other_tab', status: 'complete', mode: 'payment' })

    const res = await checkout()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_new' })
    expect(mockSessionExpire).not.toHaveBeenCalledWith('cs_new')
  })

  it('W3: a plan that ends between the read and the upsert is written back down', async () => {
    const live = stripeSub('sub_live', 'active', 'price_pro_m')
    mockSubscriptionsList.mockResolvedValue({ data: [live], has_more: false })
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(stripeSub('sub_live', 'canceled', 'price_pro_m'))

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_subscribed', recorded: false })
    expect(upserts).toHaveLength(1)
    expect(updates).toEqual([
      { id: 'sub_live', changes: { status: 'canceled', tier: 'free', ai_monthly_credits: 0 } },
    ])
    expect(row).toMatchObject({ id: 'sub_live', tier: 'free', status: 'canceled' })
    expect(mockSessionCreate).not.toHaveBeenCalled()
  })

  it('W3: a subscription Stripe no longer has after the upsert counts as ended', async () => {
    const live = stripeSub('sub_live', 'active', 'price_pro_m')
    mockSubscriptionsList.mockResolvedValue({ data: [live], has_more: false })
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(live)
      .mockRejectedValueOnce(Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 }))

    const res = await checkout()

    expect(res.status).toBe(409)
    expect(row).toMatchObject({ tier: 'free', status: 'canceled' })
  })

  it.each(['starting_after', 'customer'])('W4: resource_missing (param %s) on a later page fails closed, not a sale on a new customer', async (param) => {
    mockSubscriptionsList
      .mockResolvedValueOnce({ data: [stripeSub('sub_live', 'active', 'price_pro_m')], has_more: true })
      .mockRejectedValueOnce(
        Object.assign(new Error("No such subscription: 'sub_live'"), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
          param,
          statusCode: 400,
        })
      )

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'billing_check_failed' })
    expect(mockSessionCreate).not.toHaveBeenCalled()
    expect(upserts).toEqual([])
    expect(lines(error)).toContain(
      `Checkout: reading the customer's subscriptions failed; nothing sold: Error: Listing subscriptions page 2 failed: StripeInvalidRequestError, code resource_missing, param ${param}, status 400: No such subscription: 'sub_live'`
    )
  })

  it('W4: resource_missing for a param other than customer on the first page fails closed', async () => {
    mockSubscriptionsList.mockRejectedValue(
      Object.assign(new Error('No such thing'), { type: 'StripeInvalidRequestError', code: 'resource_missing', param: 'price', statusCode: 400 })
    )

    const res = await checkout()

    expect(res.status).toBe(503)
    expect(mockSessionCreate).not.toHaveBeenCalled()
  })
})
