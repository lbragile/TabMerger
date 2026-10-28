/**
 * The plan switch when the database and Stripe disagree (lib/planSwitch.ts, lib/stripe.ts,
 * lib/subscriptionSync.ts): the account's row still shows a paid plan that Stripe says has ended,
 * because a webhook delivery was missed. The real routes and libraries run against a mocked Stripe
 * SDK and an in-memory `subscriptions` row, so these tests see both the response and the row.
 *
 * - No entitled subscription at Stripe: the row is corrected from Stripe, one line is logged, and
 *   the 403 `no_paid_plan` carries `checkout`; `/api/checkout` then accepts the account.
 * - A live subscription on a price this deployment doesn't know: nothing is corrected (no
 *   downgrade), and `/api/checkout` still refuses a second subscription.
 * - A customer id Stripe doesn't have (`resource_missing`): 400 `no_billing_account`, never a 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { NextRequest } from 'next/server'
import { hasCloudSync } from '@/lib/cloudSync'
import { SAME_ORIGIN_HEADERS } from './helpers/billingRequest'
// The per-user billing limit is tested in rateLimit.test.ts and billingRequestGuard.test.ts; here
// it always allows, so these tests need no limiter RPC on their Supabase mock.
vi.mock('@/lib/rateLimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rateLimit')>()),
  takeRateLimit: vi.fn(async () => ({ kind: 'allowed' })),
}))

type Row = {
  id: string
  user_id: string
  tier: string
  status: string
  stripe_price_id: string | null
  ai_mode: string
  ai_monthly_credits?: number
}

/** The account's one `subscriptions` row, as both routes read it and the resync writes it. */
let row: Row
let profile: { stripe_customer_id: string | null }
const subscriptionUpdates: Array<{ changes: Record<string, unknown>; id: string }> = []

const mockGetUser = vi.fn()

vi.mock('@/lib/supabase/server', () => {
  /** A select chain whose terminal call returns the row or the profile. */
  const reader = (table: string) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.order = () => q
    q.limit = () => q
    q.maybeSingle = async () => ({ data: table === 'subscriptions' ? { ...row } : null, error: null })
    q.single = async () => ({ data: table === 'profiles' ? { ...profile } : null, error: null })
    return q
  }
  return {
    createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser }, from: reader })),
    createServiceRoleClient: vi.fn(async () => ({
      from: (table: string) => ({
        ...reader(table),
        // `.update(changes).eq('id', id).select('id')`: changes only the row stored under that id.
        update: (changes: Record<string, unknown>) => ({
          eq: (_column: string, id: string) => ({
            select: async () => {
              subscriptionUpdates.push({ changes, id })
              if (row.id !== id) return { data: [], error: null }
              row = { ...row, ...changes }
              return { data: [{ id }], error: null }
            },
          }),
        }),
      }),
    })),
  }
})

const mockSubscriptionsList = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockPriceRetrieve = vi.fn()
const mockPortalCreate = vi.fn()
const mockConfigList = vi.fn()
const mockConfigCreate = vi.fn()
const mockCheckoutCreate = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: mockSubscriptionsList, retrieve: mockSubscriptionsRetrieve }
    prices = { retrieve: mockPriceRetrieve }
    billingPortal = {
      sessions: { create: mockPortalCreate },
      configurations: { list: mockConfigList, create: mockConfigCreate },
    }
    subscriptionSchedules = { create: vi.fn(), update: vi.fn(), release: vi.fn() }
    checkout = {
      sessions: {
        create: mockCheckoutCreate,
        // The new checkout expires the customer's other open ones (none here).
        list: vi.fn(async () => ({ data: [], has_more: false })),
        expire: vi.fn(),
      },
    }
  },
}))

const stripeSub = (id: string, status: string, priceId: string, customer = 'cus_1') => ({
  id,
  status,
  customer,
  items: { data: [{ id: `si_${id}`, price: { id: priceId } }] },
})

/** What Stripe answers a subscriptions list for an unknown customer (test mode, 2026-10-24: HTTP 400, not 404). */
function resourceMissing(): Error {
  return Object.assign(new Error("No such customer: 'cus_test_seeded'"), {
    type: 'StripeInvalidRequestError',
    code: 'resource_missing',
    statusCode: 400,
  })
}

async function switchPlan(body: unknown) {
  const { POST } = await import('@/app/api/billing/switch-plan/route')
  return POST(new NextRequest('http://localhost/api/billing/switch-plan', { method: 'POST', headers: SAME_ORIGIN_HEADERS, body: JSON.stringify(body) }))
}

async function switchInterval(body: unknown) {
  const { POST } = await import('@/app/api/billing/switch-interval/route')
  return POST(new NextRequest('http://localhost/api/billing/switch-interval', { method: 'POST', headers: SAME_ORIGIN_HEADERS, body: JSON.stringify(body) }))
}

async function checkout(body: unknown) {
  const { POST } = await import('@/app/api/checkout/route')
  return POST(new NextRequest('http://localhost/api/checkout', { method: 'POST', headers: SAME_ORIGIN_HEADERS, body: JSON.stringify(body) }))
}

const PRO_ACTIVE: Row = {
  id: 'sub_old',
  user_id: 'user-1',
  tier: 'pro',
  status: 'active',
  stripe_price_id: 'price_pro_m',
  ai_mode: 'managed',
}

let warn: MockInstance<typeof console.warn>
let error: MockInstance<typeof console.error>

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  subscriptionUpdates.length = 0
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
  row = { ...PRO_ACTIVE }
  profile = { stripe_customer_id: 'cus_1' }
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  mockPriceRetrieve.mockImplementation(async (id: string) => ({ id, active: true, product: `prod_of_${id}` }))
  mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' })
  mockConfigList.mockResolvedValue({ data: [] })
  mockConfigCreate.mockResolvedValue({ id: 'bpc_target' })
  mockCheckoutCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/new' })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  warn.mockRestore()
  error.mockRestore()
})

describe('drift: the row shows a plan that has ended at Stripe', () => {
  beforeEach(() => {
    // Stripe lists no subscription that isn't canceled; the row's own one is canceled.
    mockSubscriptionsList.mockResolvedValue({ data: [], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'canceled', 'price_pro_m'))
  })

  it('corrects the row from Stripe and answers no_paid_plan with the plan to check out', async () => {
    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'No paid plan to switch',
      code: 'no_paid_plan',
      checkout: { tier: 'proAi', interval: 'monthly', aiMode: 'managed' },
    })
    // The webhook's write for an ended plan, keyed on the row's own subscription id.
    expect(subscriptionUpdates).toEqual([
      { id: 'sub_old', changes: { status: 'canceled', tier: 'free', ai_monthly_credits: 0 } },
    ])
    expect(row).toMatchObject({ id: 'sub_old', tier: 'free', status: 'canceled', ai_monthly_credits: 0 })
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_old', expect.anything())
    expect(mockPortalCreate).not.toHaveBeenCalled()
    // One line for the correction, with no user id or email.
    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines).toEqual([
      'Plan switch: corrected a row whose plan had ended at Stripe (subscription sub_old: pro/active -> free/canceled)',
    ])
  })

  it('then /api/checkout accepts the account and reuses its Stripe customer', async () => {
    const switched = await (await switchPlan({ tier: 'proAi' })).json()

    const res = await checkout(switched.checkout)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/new' })
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        mode: 'subscription',
        line_items: [{ price: 'price_ai_m', quantity: 1 }],
      }),
      expect.anything()
    )
  })

  it('writes a final status the database does not store (incomplete_expired) as canceled / free, with checkout', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [stripeSub('sub_old', 'incomplete_expired', 'price_pro_m')],
      has_more: false,
    })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'incomplete_expired', 'price_pro_m'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect((await res.json()).checkout).toEqual({ tier: 'proAi', interval: 'monthly', aiMode: 'managed' })
    expect(row).toMatchObject({ tier: 'free', status: 'canceled', ai_monthly_credits: 0 })
  })

  it('writes a stored status that is not entitled with tier free (hasCloudSync false afterwards)', async () => {
    // Stripe lists nothing open, but the row's own subscription reads as incomplete when it is
    // retrieved: the status is stored as is, the tier is always free.
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'incomplete', 'price_pro_m'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(subscriptionUpdates).toEqual([
      { id: 'sub_old', changes: { status: 'incomplete', tier: 'free', ai_monthly_credits: 0 } },
    ])
    expect(hasCloudSync(row)).toBe(false)
  })

  it('an interval switch gets a checkout for the same plan at the new interval', async () => {
    const res = await switchInterval({ interval: 'yearly' })

    expect(res.status).toBe(403)
    expect((await res.json()).checkout).toEqual({ tier: 'pro', interval: 'yearly' })
    expect(row).toMatchObject({ tier: 'free', status: 'canceled' })
  })

  it('leaves alone a row a new subscription took over meanwhile (the write is keyed on the old id)', async () => {
    mockSubscriptionsRetrieve.mockImplementation(async () => {
      // A checkout completes while Stripe is being read: the webhook moves the row to sub_new.
      row = { ...row, id: 'sub_new', tier: 'pro_ai', status: 'active', stripe_price_id: 'price_ai_m' }
      return stripeSub('sub_old', 'canceled', 'price_pro_m')
    })

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('checkout')
    expect(row).toMatchObject({ id: 'sub_new', tier: 'pro_ai', status: 'active' })
  })

  it('does not write when the row names a subscription of another customer', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'canceled', 'price_pro_m', 'cus_other'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('checkout')
    expect(subscriptionUpdates).toEqual([])
    expect(row).toEqual(PRO_ACTIVE)
  })

  it('does not write when the row’s subscription is live at Stripe after all', async () => {
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'active', 'price_pro_m'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('checkout')
    expect(row).toEqual(PRO_ACTIVE)
  })

  it('does not write when Stripe has no subscription with the row’s id', async () => {
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error('No such subscription'), { code: 'resource_missing', statusCode: 404 })
    )

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'No paid plan to switch', code: 'no_paid_plan' })
    expect(row).toEqual(PRO_ACTIVE)
  })

  it('does not call Stripe for a row that names no Stripe subscription (the signup row)', async () => {
    row = { ...PRO_ACTIVE, id: 'free_user-1' }

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('checkout')
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(subscriptionUpdates).toEqual([])
  })

  it('answers 500 switch_failed, writing nothing, when Stripe cannot be read', async () => {
    mockSubscriptionsRetrieve.mockRejectedValue(
      Object.assign(new Error('Server error'), { type: 'StripeAPIError', statusCode: 500 })
    )

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('switch_failed')
    expect(row).toEqual(PRO_ACTIVE)
    expect(error).toHaveBeenCalledWith(
      'Plan switch resync: subscription retrieve failed (subscription sub_old, StripeAPIError, status 500)'
    )
  })
})

describe('a plan that can still be paid or resumed (unpaid, paused, incomplete)', () => {
  it.each(['unpaid', 'paused'])(
    'a %s subscription: the row is corrected, but the answer is 409 pay_or_resume with no checkout',
    async (status) => {
      mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_old', status, 'price_pro_m')], has_more: false })
      mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', status, 'price_pro_m'))

      const res = await switchPlan({ tier: 'proAi' })

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.code).toBe('pay_or_resume')
      expect(body).not.toHaveProperty('checkout')
      // Not a stored status: written the way the webhook writes it.
      expect(row).toMatchObject({ id: 'sub_old', tier: 'free', status: 'canceled', ai_monthly_credits: 0 })
      expect(hasCloudSync(row)).toBe(false)
      expect(mockPortalCreate).not.toHaveBeenCalled()
      expect(mockCheckoutCreate).not.toHaveBeenCalled()
    }
  )

  it('an incomplete subscription on the row: written incomplete / free, hasCloudSync false, no checkout', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_old', 'incomplete', 'price_pro_m')], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'incomplete', 'price_pro_m'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Your plan is waiting for a payment or is paused. Pay or resume it in Manage billing before changing it.',
      code: 'pay_or_resume',
    })
    expect(subscriptionUpdates).toEqual([
      { id: 'sub_old', changes: { status: 'incomplete', tier: 'free', ai_monthly_credits: 0 } },
    ])
    expect(hasCloudSync(row)).toBe(false)
  })

  it('an open subscription other than the row one: the ended row is corrected, still no checkout', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_other', 'paused', 'price_pro_m')], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'canceled', 'price_pro_m'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(409)
    expect(await res.json()).not.toHaveProperty('checkout')
    expect(row).toMatchObject({ id: 'sub_old', tier: 'free', status: 'canceled' })
  })

  it('still answers pay_or_resume when the row cannot be corrected', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [stripeSub('sub_old', 'unpaid', 'price_pro_m')], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'unpaid', 'price_pro_m', 'cus_other'))

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('pay_or_resume')
    expect(row).toEqual(PRO_ACTIVE)
  })
})

describe('drift while the Pro AI option is not on sale', () => {
  beforeEach(() => {
    mockSubscriptionsList.mockResolvedValue({ data: [], has_more: false })
    mockSubscriptionsRetrieve.mockResolvedValue(stripeSub('sub_old', 'canceled', 'price_pro_m'))
  })

  it.each([
    ['managed, with the managed flag off', { tier: 'proAi' }, 'false', 'true'],
    ['own key, with both flags off', { tier: 'proAi', aiMode: 'byok' }, 'false', 'false'],
  ])('%s: 503 ai_disabled before Stripe is asked, nothing written', async (_label, body, managed, byok) => {
    vi.stubEnv('NEXT_PUBLIC_AI_ENABLED', managed)
    vi.stubEnv('NEXT_PUBLIC_AI_BYOK_ENABLED', byok)

    const res = await switchPlan(body)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'ai_disabled' })
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(subscriptionUpdates).toEqual([])
    expect(row).toEqual(PRO_ACTIVE)
  })
})

describe('no drift: Stripe has a live subscription the switch cannot use', () => {
  it('a live subscription on an unknown price is never downgraded, and checkout still refuses', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [stripeSub('sub_old', 'active', 'price_legacy')],
      has_more: false,
    })

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'No paid plan to switch', code: 'no_paid_plan' })
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(subscriptionUpdates).toEqual([])
    expect(row).toEqual(PRO_ACTIVE)

    // The client can't reach a second subscription through checkout either.
    const second = await checkout({ tier: 'proAi', interval: 'monthly' })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'already_subscribed', recorded: true })
    expect(mockCheckoutCreate).not.toHaveBeenCalled()
  })

  it('a list with more pages than were read is not taken as "no plan"', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [stripeSub('sub_x', 'incomplete_expired', 'price_pro_m')],
      has_more: true,
    })

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('checkout')
    expect(subscriptionUpdates).toEqual([])
  })
})

describe('a Stripe customer id Stripe does not have', () => {
  it('answers 400 no_billing_account, not 500, and changes nothing', async () => {
    profile = { stripe_customer_id: 'cus_test_seeded' }
    mockSubscriptionsList.mockRejectedValue(resourceMissing())

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'No billing account found', code: 'no_billing_account' })
    expect(subscriptionUpdates).toEqual([])
    expect(row).toEqual(PRO_ACTIVE)
    // Logged without the customer id.
    expect(warn).toHaveBeenCalledWith('Plan switch: Stripe has no customer for this account (resource_missing)')
    expect(String(warn.mock.calls[0][0])).not.toContain('cus_test_seeded')
  })

  it('still answers 500 switch_failed for any other Stripe failure of the list', async () => {
    mockSubscriptionsList.mockRejectedValue(
      Object.assign(new Error('Rate limited'), { type: 'StripeRateLimitError', statusCode: 429 })
    )

    const res = await switchPlan({ tier: 'proAi' })

    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('switch_failed')
  })
})
