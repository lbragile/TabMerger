/**
 * The Stripe webhook's Pro AI columns: `subscriptions.ai_mode` (from the price) and
 * `ai_monthly_credits` (the managed allowance funded by what the subscription actually pays,
 * after discounts), on every subscription write, and the `customer.discount.*` events that make
 * the allowance follow a coupon. The pricing rules themselves live in lib/aiAllowance.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PRO_AI_MONTHLY_CREDITS, creditsForPayment } from '@tabmerger/shared'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))

const mockConstructEvent = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockCouponsRetrieve = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    coupons: { retrieve: mockCouponsRetrieve },
    checkout: { sessions: { listLineItems: vi.fn() } },
  },
}))

const USER = '11111111-1111-4111-8111-111111111111'
const mockUpsert = vi.fn()
const mockFrom = vi.fn()
/** Answers of the lookups by column: `id` / `stripe_customer_id` on profiles, `id` / `user_id` on subscriptions. */
let lookups: Record<string, { data: unknown; error: unknown }> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => ({ from: mockFrom })),
}))

function tables() {
  mockFrom.mockImplementation((table: string) => {
    let column = ''
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((c: string) => {
        column = c
        return chain
      }),
      maybeSingle: vi.fn(async () => lookups[`${table}.${column}`] ?? { data: null, error: null }),
      single: vi.fn(async () => lookups[`${table}.${column}`] ?? { data: null, error: { code: 'PGRST116' } }),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
      upsert: mockUpsert,
    }
    return chain
  })
}

function request() {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  })
}

function subscription(overrides: Record<string, unknown> = {}) {
  const { price = 'price_ai_m', ...rest } = overrides
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { user_id: USER },
    discounts: [],
    latest_invoice: null,
    items: { data: [{ price: { id: price }, current_period_end: 1800000000, discounts: [] }] },
    ...rest,
  }
}

/** A subscription-level discount whose coupon is expanded (current API: `source.coupon`). */
function discount(coupon: Record<string, unknown>, id = 'di_1') {
  return { id, object: 'discount', source: { type: 'coupon', coupon: { id: 'co_1', ...coupon } } }
}

/** An update event; Stripe's current state of the subscription is `sub`. */
async function postUpdate(sub: Record<string, unknown>) {
  mockSubscriptionsRetrieve.mockResolvedValue(sub)
  mockConstructEvent.mockReturnValue({ type: 'customer.subscription.updated', data: { object: sub } })
  const { POST } = await import('@/app/api/webhooks/stripe/route')
  return POST(request())
}

function written() {
  expect(mockUpsert).toHaveBeenCalledTimes(1)
  const row = mockUpsert.mock.calls[0][0]
  return { ai_mode: row.ai_mode, ai_monthly_credits: row.ai_monthly_credits }
}

let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mockSubscriptionsRetrieve.mockReset()
  mockCouponsRetrieve.mockReset()
  mockUpsert.mockResolvedValue({ error: null })
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
  vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_y')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
  // The row already tracks sub_1 for USER.
  lookups = { 'subscriptions.id': { data: { user_id: USER }, error: null } }
  tables()
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('ai_mode and ai_monthly_credits on every subscription write', () => {
  it('reads the subscription with the discounts, latest invoice and customer expanded', async () => {
    await postUpdate(subscription())
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_1', {
      expand: ['discounts', 'items.data.discounts', 'latest_invoice', 'customer'],
    })
  })

  it.each([
    ['monthly', 'price_ai_m'],
    ['yearly', 'price_ai_y'],
  ])('managed Pro AI at full price (%s) gets the advertised allowance', async (_label, price) => {
    const res = await postUpdate(subscription({ price }))
    expect(res.status).toBe(200)
    expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS })
    expect(PRO_AI_MONTHLY_CREDITS).toBe(2600)
  })

  it.each([
    ['monthly', 'price_byok_m'],
    ['yearly', 'price_byok_y'],
  ])('own-key Pro AI (%s) is ai_mode byok with 0 credits, tier pro_ai', async (_label, price) => {
    await postUpdate(subscription({ price }))
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ tier: 'pro_ai', ai_mode: 'byok', ai_monthly_credits: 0 })
  })

  it('a completed checkout writes the columns too', async () => {
    const sub = subscription({ price: 'price_byok_y' })
    mockSubscriptionsRetrieve.mockResolvedValue(sub)
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', mode: 'subscription', subscription: 'sub_1', customer: 'cus_1', metadata: { user_id: USER } } },
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    expect((await POST(request())).status).toBe(200)
    expect(written()).toEqual({ ai_mode: 'byok', ai_monthly_credits: 0 })
  })

  it.each([
    ['Pro', subscription({ price: 'price_pro_m' }), { tier: 'pro', ai_mode: 'managed', ai_monthly_credits: 0 }],
    ['an unknown price', subscription({ price: 'price_legacy' }), { tier: 'free', ai_mode: 'managed', ai_monthly_credits: 0 }],
    ['a canceled Pro AI subscription', subscription({ status: 'canceled' }), { tier: 'free', ai_monthly_credits: 0 }],
    ['an unpaid Pro AI subscription', subscription({ status: 'unpaid' }), { tier: 'free', ai_monthly_credits: 0 }],
    ['a trial (nothing paid yet)', subscription({ status: 'trialing' }), { tier: 'pro_ai', ai_monthly_credits: 0 }],
  ])('%s gets no managed credits', async (_label, sub, expected) => {
    await postUpdate(sub)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject(expected)
  })
})

describe('discounts lower the managed allowance', () => {
  it('a 50%-off coupon funds the credits of half the price', async () => {
    await postUpdate(subscription({ discounts: [discount({ percent_off: 50 })] }))
    // $7.99 at 50% is 399.5 cents, rounded down to 399.
    expect(written().ai_monthly_credits).toBe(creditsForPayment(3.99))
    expect(written().ai_monthly_credits).toBe(1380)
  })

  it('a 100%-off coupon funds nothing', async () => {
    await postUpdate(subscription({ discounts: [discount({ percent_off: 100 })] }))
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('a USD amount_off is taken off the price', async () => {
    await postUpdate(subscription({ discounts: [discount({ amount_off: 200, currency: 'usd' })] }))
    expect(written().ai_monthly_credits).toBe(creditsForPayment(5.99))
  })

  it('a yearly plan at 50% off: the allowance is per month of the yearly payment', async () => {
    await postUpdate(subscription({ price: 'price_ai_y', discounts: [discount({ percent_off: 50 })] }))
    expect(written().ai_monthly_credits).toBe(creditsForPayment(42.99, 12))
  })

  it('an amount_off in another currency counts as 100% off, logged without PII', async () => {
    await postUpdate(subscription({ discounts: [discount({ amount_off: 200, currency: 'eur' })] }))
    expect(written().ai_monthly_credits).toBe(0)
    expect(warnSpy.mock.calls).toEqual([
      [
        "Stripe webhook: customer.subscription.updated a discount can't be priced in USD (amount_off in eur); managed AI credits are written as 0 (subscription sub_1)",
      ],
    ])
  })

  it('a coupon with neither percent_off nor amount_off counts as 100% off', async () => {
    await postUpdate(subscription({ discounts: [discount({})] }))
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('a discount Stripe did not expand counts as 100% off', async () => {
    await postUpdate(subscription({ discounts: ['di_unexpanded'] }))
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('stacked discounts apply in order: item discounts first, then the subscription’s', async () => {
    const sub = subscription({ discounts: [discount({ amount_off: 100, currency: 'usd' }, 'di_sub')] })
    ;(sub.items.data[0] as { discounts: unknown[] }).discounts = [discount({ percent_off: 50 }, 'di_item')]
    await postUpdate(sub)
    // 799 → 399 (50%) → 299 ($1 off).
    expect(written().ai_monthly_credits).toBe(creditsForPayment(2.99))
  })

  it('reads the older top-level `coupon` shape too', async () => {
    await postUpdate(subscription({ discounts: [{ id: 'di_1', coupon: { id: 'co_1', percent_off: 100 } }] }))
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('looks up a coupon given by id, and a deleted coupon counts as 100% off', async () => {
    mockCouponsRetrieve.mockResolvedValueOnce({ id: 'co_1', percent_off: 50 })
    await postUpdate(subscription({ discounts: [{ id: 'di_1', source: { type: 'coupon', coupon: 'co_1' } }] }))
    expect(mockCouponsRetrieve).toHaveBeenCalledWith('co_1')
    expect(written().ai_monthly_credits).toBe(1380)

    mockUpsert.mockClear()
    mockCouponsRetrieve.mockRejectedValueOnce(Object.assign(new Error('No such coupon'), { code: 'resource_missing' }))
    await postUpdate(subscription({ discounts: [{ id: 'di_1', source: { type: 'coupon', coupon: 'co_gone' } }] }))
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('answers 500 and writes nothing when a coupon cannot be read for another reason', async () => {
    mockCouponsRetrieve.mockRejectedValue(
      Object.assign(new Error('boom'), { type: 'StripeAPIError', statusCode: 503, headers: { secret: 'x' } })
    )
    const res = await postUpdate(subscription({ discounts: [{ id: 'di_1', source: { type: 'coupon', coupon: 'co_1' } }] }))
    expect(res.status).toBe(500)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls).toEqual([
      ['Stripe webhook: customer.subscription.updated coupon retrieve failed (subscription sub_1, StripeAPIError, status 503)'],
    ])
  })

  it('uses the customer’s discount when the subscription has none of its own', async () => {
    await postUpdate(
      subscription({ customer: { id: 'cus_1', object: 'customer', discount: discount({ percent_off: 100 }) } })
    )
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('ignores the customer’s discount when the subscription has its own', async () => {
    await postUpdate(
      subscription({
        customer: { id: 'cus_1', object: 'customer', discount: discount({ percent_off: 100 }, 'di_cus') },
        discounts: [discount({ percent_off: 50 })],
      })
    )
    expect(written().ai_monthly_credits).toBe(1380)
  })

  // A "once" coupon leaves the subscription as soon as the first invoice is finalized, so only the
  // latest invoice shows what this period was actually charged.
  it('a 100%-off first invoice funds nothing even though the coupon is already gone', async () => {
    await postUpdate(
      subscription({ latest_invoice: { id: 'in_1', subtotal: 799, total_discount_amounts: [{ amount: 799, discount: 'di_1' }] } })
    )
    expect(written().ai_monthly_credits).toBe(0)
  })

  it('a half-price latest invoice halves the allowance; a full-price one restores it', async () => {
    await postUpdate(
      subscription({ latest_invoice: { id: 'in_1', subtotal: 799, total_discount_amounts: [{ amount: 400, discount: 'di_1' }] } })
    )
    expect(written().ai_monthly_credits).toBe(creditsForPayment(3.99))

    mockUpsert.mockClear()
    await postUpdate(subscription({ latest_invoice: { id: 'in_2', subtotal: 799, total_discount_amounts: [] } }))
    expect(written().ai_monthly_credits).toBe(2600)
  })

  it('a latest invoice with no positive subtotal (a proration credit) does not lower the allowance', async () => {
    await postUpdate(subscription({ latest_invoice: { id: 'in_1', subtotal: -200, total_discount_amounts: null } }))
    expect(written().ai_monthly_credits).toBe(2600)
  })
})

describe('customer.discount.* events re-read the subscription', () => {
  function discountEvent(type: string, object: Record<string, unknown>) {
    mockConstructEvent.mockReturnValue({ type, data: { object } })
  }

  it.each(['customer.discount.created', 'customer.discount.updated', 'customer.discount.deleted'])(
    '%s on a subscription writes that subscription’s current state',
    async (type) => {
      mockSubscriptionsRetrieve.mockResolvedValue(subscription({ discounts: [discount({ percent_off: 50 })] }))
      discountEvent(type, { id: 'di_1', object: 'discount', subscription: 'sub_1', customer: 'cus_1' })
      const { POST } = await import('@/app/api/webhooks/stripe/route')

      expect((await POST(request())).status).toBe(200)
      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_1', expect.anything())
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ id: 'sub_1', user_id: USER, ai_monthly_credits: 1380 })
    }
  )

  it('a discount on the customer re-reads the subscription the customer’s account holds', async () => {
    lookups['profiles.stripe_customer_id'] = { data: { id: USER }, error: null }
    lookups['subscriptions.user_id'] = { data: { id: 'sub_1' }, error: null }
    mockSubscriptionsRetrieve.mockResolvedValue(subscription())
    discountEvent('customer.discount.deleted', { id: 'di_c', object: 'discount', subscription: null, customer: 'cus_1' })
    const { POST } = await import('@/app/api/webhooks/stripe/route')

    expect((await POST(request())).status).toBe(200)
    expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_1', expect.anything())
    expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: 2600 })
  })

  it.each([
    ['no profile holds the customer', {}],
    ['the account’s row is the signup row', { 'profiles.stripe_customer_id': { data: { id: USER }, error: null }, 'subscriptions.user_id': { data: { id: `free_${USER}` }, error: null } }],
  ])('a customer discount where %s writes nothing (200)', async (_label, extra) => {
    Object.assign(lookups, extra)
    discountEvent('customer.discount.created', { id: 'di_c', object: 'discount', subscription: null, customer: { id: 'cus_1' } })
    const { POST } = await import('@/app/api/webhooks/stripe/route')

    expect((await POST(request())).status).toBe(200)
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls).toEqual([
      ['Stripe webhook: customer.discount.created matched no subscription row or user (subscription none)'],
    ])
  })

  it('a failed lookup for a customer discount answers 500', async () => {
    lookups['profiles.stripe_customer_id'] = { data: null, error: { code: '57014' } }
    discountEvent('customer.discount.created', { id: 'di_c', object: 'discount', subscription: null, customer: 'cus_1' })
    const { POST } = await import('@/app/api/webhooks/stripe/route')

    expect((await POST(request())).status).toBe(500)
    expect(errorSpy.mock.calls).toEqual([
      ['Stripe webhook: customer.discount.created customer profile lookup failed (customer discount, code 57014)'],
    ])
  })

  it('a discount event with no customer at all matches nothing (200)', async () => {
    discountEvent('customer.discount.deleted', { id: 'di_x', object: 'discount', subscription: null, customer: null })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    expect((await POST(request())).status).toBe(200)
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
