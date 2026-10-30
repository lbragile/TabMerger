/**
 * The Stripe webhook's Pro AI columns: `subscriptions.ai_mode` (from the price) and
 * `ai_monthly_credits` (the managed allowance funded by what the subscription actually pays,
 * after discounts), on every subscription write, and the `customer.discount.*` events that make
 * the allowance follow a coupon. The pricing rules themselves live in lib/aiAllowance.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PRO_AI_MONTHLY_CREDITS, creditsForPayment, monthlyAllowanceForPayment } from '@tabmerger/shared'

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
    expect(PRO_AI_MONTHLY_CREDITS).toBe(2500)
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
    // A renewal payment is failing: Pro (sync) stays, but no managed credits until it is paid, so a
    // new UTC month during dunning brings no fresh allowance. Migration 027 keeps what the
    // allowance already paid for this month (ai_usage.allowance_spent), so packs stay spendable.
    ['a past_due subscription (renewal payment failing)', subscription({ status: 'past_due' }), { tier: 'pro_ai', status: 'past_due', ai_monthly_credits: 0 }],
    ['an incomplete first payment', subscription({ status: 'incomplete' }), { tier: 'pro_ai', status: 'incomplete', ai_monthly_credits: 0 }],
  ])('%s gets no managed credits', async (_label, sub, expected) => {
    await postUpdate(sub)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject(expected)
  })
})

describe('a downgrade scheduled for the end of the period (lib/stripe.ts scheduleChangeAtPeriodEnd)', () => {
  // Creating the schedule fires customer.subscription.updated (the subscription gains `schedule`);
  // when the next phase starts at the period end, Stripe moves the subscription to the phase's
  // price and fires customer.subscription.updated again. Both go through the ordinary handler.

  it('while the schedule is pending, the row keeps the plan that was paid for', async () => {
    const res = await postUpdate(subscription({ price: 'price_ai_y', schedule: 'sub_sched_1' }))
    expect(res.status).toBe(200)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      tier: 'pro_ai',
      ai_mode: 'managed',
      ai_monthly_credits: PRO_AI_MONTHLY_CREDITS,
      stripe_price_id: 'price_ai_y',
    })
  })

  it('Pro AI → Pro: when the phase starts, the row moves to Pro with no AI credits', async () => {
    const res = await postUpdate(subscription({ price: 'price_pro_y', schedule: 'sub_sched_1' }))
    expect(res.status).toBe(200)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      id: 'sub_1',
      user_id: USER,
      tier: 'pro',
      status: 'active',
      ai_mode: 'managed',
      ai_monthly_credits: 0,
      stripe_price_id: 'price_pro_y',
    })
  })

  it('managed → own key: when the phase starts, the row becomes own-key Pro AI with no credits', async () => {
    await postUpdate(subscription({ price: 'price_byok_m', schedule: 'sub_sched_1' }))
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      tier: 'pro_ai',
      ai_mode: 'byok',
      ai_monthly_credits: 0,
      stripe_price_id: 'price_byok_m',
    })
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
    expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
  })

  it('a latest invoice with no positive subtotal (a proration credit) does not lower the allowance', async () => {
    await postUpdate(subscription({ latest_invoice: { id: 'in_1', subtotal: -200, total_discount_amounts: null } }))
    expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
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
    expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS })
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

// The Pro AI setup option switched alone. Managed → own key is cheaper, so the portal's confirm
// page defers it to the end of the paid period (the configuration's decreasing_item_amount
// condition; a 1-second schedule phase moves the price at the renewal, measured in test mode
// 2026-10-26). Until then the row keeps managed and its allowance; when it lands, the renewal's
// invoice is the new price in full, with no proration lines. Own key → managed is an upgrade,
// charged at once and prorated (the proportional allowance is in the describe block below).
describe('Pro AI option switched through the portal', () => {
  it('managed → own key is deferred: managed with its allowance until the period end, then byok with 0 credits', async () => {
    const pending = await postUpdate(subscription({ price: 'price_ai_m', schedule: 'sub_sched_1' }))
    expect(pending.status).toBe(200)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      tier: 'pro_ai',
      ai_mode: 'managed',
      ai_monthly_credits: PRO_AI_MONTHLY_CREDITS,
    })

    mockUpsert.mockClear()
    const landed = await postUpdate(
      subscription({
        price: 'price_byok_m',
        schedule: 'sub_sched_1',
        // The renewal's invoice on the new price: no proration line, no credit.
        latest_invoice: { id: 'in_1', billing_reason: 'subscription_update', status: 'draft', subtotal: 599, total: 599, amount_due: 599, total_discount_amounts: [] },
      })
    )
    expect(landed.status).toBe(200)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ tier: 'pro_ai', ai_mode: 'byok', ai_monthly_credits: 0 })
  })

  it.each([
    ['monthly', 'price_ai_m', PRO_AI_MONTHLY_CREDITS],
    ['yearly', 'price_ai_y', PRO_AI_MONTHLY_CREDITS],
  ])('a latest invoice with no line for the new managed price (%s) keeps the full monthly allowance', async (_label, price, credits) => {
    // Nothing on the invoice says how much of the period is left (no proration line for the new
    // price), so the full monthly figure stands.
    await postUpdate(
      subscription({
        price,
        latest_invoice: { id: 'in_2', subtotal: 200, total: 200, amount_due: 200, total_discount_amounts: [] },
      })
    )
    expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: credits })
  })
})


// A mid-period upgrade into managed is charged now with proration (always_invoice): the invoice has
// a positive proration line for the new price covering the rest of the period. The allowance until
// the renewal follows that span, not the full month (line shapes as the pinned API version returns
// them: `parent.subscription_item_details.proration`, `pricing.price_details.price`).
describe('mid-period upgrade into managed: allowance in proportion to the time charged', () => {
  const DAY = 86_400
  const START = 1_800_000_000
  const MONTH_END = START + 30 * DAY
  const YEAR_END = START + 365 * DAY

  function prorationLine(price: string, amount: number, from: number, to: number) {
    return {
      amount,
      period: { start: from, end: to },
      parent: { type: 'subscription_item_details', subscription_item_details: { proration: true } },
      pricing: { price_details: { price } },
    }
  }

  function upgraded({
    price = 'price_ai_m',
    end = MONTH_END,
    lines,
    billing_reason = 'subscription_update',
    status = 'paid',
    subtotal = 100,
    total_discount_amounts = [],
  }: {
    price?: string
    end?: number
    lines: unknown[]
    billing_reason?: string
    status?: string
    subtotal?: number
    total_discount_amounts?: unknown[]
  }) {
    return subscription({
      price,
      items: { data: [{ price: { id: price }, current_period_start: START, current_period_end: end, discounts: [] }] },
      latest_invoice: { id: 'in_up', billing_reason, status, subtotal, total: subtotal, total_discount_amounts, lines: { data: lines } },
    })
  }

  function fullLine(price: string, amount: number, from: number, to: number, discount = 0) {
    return {
      amount,
      discount_amounts: [{ amount: discount, discount: 'di_1' }],
      period: { start: from, end: to },
      parent: { type: 'subscription_item_details', subscription_item_details: { proration: false } },
      pricing: { price_details: { price } },
    }
  }

  it.each([
    ['half the month left', 15, 1250],
    ['one day left', 1, Math.floor((PRO_AI_MONTHLY_CREDITS * 1) / 30)],
  ])('own key → managed with %s', async (_label, daysLeft, credits) => {
    await postUpdate(
      upgraded({
        lines: [
          prorationLine('price_byok_m', -300, MONTH_END - daysLeft * DAY, MONTH_END),
          prorationLine('price_ai_m', 400, MONTH_END - daysLeft * DAY, MONTH_END),
        ],
      })
    )
    expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: credits })
  })

  it('Pro → Pro AI managed (yearly, 10 days left) counts the days in months of the yearly period', async () => {
    await postUpdate(
      upgraded({
        price: 'price_ai_y',
        end: YEAR_END,
        lines: [prorationLine('price_ai_y', 235, YEAR_END - 10 * DAY, YEAR_END)],
      })
    )
    expect(written().ai_monthly_credits).toBe(Math.floor(PRO_AI_MONTHLY_CREDITS * ((10 * DAY) / ((365 * DAY) / 12))))
  })

  it('a yearly upgrade with months left keeps the full monthly allowance', async () => {
    await postUpdate(
      upgraded({ price: 'price_ai_y', end: YEAR_END, lines: [prorationLine('price_ai_y', 4000, YEAR_END - 180 * DAY, YEAR_END)] })
    )
    expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
  })

  it('monthly → yearly into managed restarts the period (no proration line for the new price): full allowance', async () => {
    await postUpdate(
      upgraded({
        price: 'price_ai_y',
        end: YEAR_END,
        lines: [
          prorationLine('price_byok_m', -300, START, START + 15 * DAY),
          { amount: 8599, period: { start: START, end: YEAR_END }, parent: { subscription_item_details: { proration: false } }, pricing: { price_details: { price: 'price_ai_y' } } },
        ],
      })
    )
    expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
  })

  it('reads the older line shape too (top-level proration and price)', async () => {
    await postUpdate(
      upgraded({ lines: [{ amount: 400, proration: true, price: { id: 'price_ai_m' }, period: { start: MONTH_END - 15 * DAY, end: MONTH_END } }] })
    )
    expect(written().ai_monthly_credits).toBe(1250)
  })

  it('a redelivery, or a later update in the same period, writes the same reduced figure', async () => {
    const sub = upgraded({ lines: [prorationLine('price_ai_m', 400, MONTH_END - 15 * DAY, MONTH_END)] })
    await postUpdate(sub)
    expect(written().ai_monthly_credits).toBe(1250)

    // Later in the period (e.g. the customer sets the plan to cancel): the latest invoice is still
    // the upgrade's, so nothing resets it to the full allowance.
    mockUpsert.mockClear()
    await postUpdate({ ...sub, cancel_at_period_end: true })
    expect(written().ai_monthly_credits).toBe(1250)
  })

  it("the next renewal's invoice brings the full allowance back", async () => {
    await postUpdate(
      upgraded({
        billing_reason: 'subscription_cycle',
        lines: [{ amount: 799, period: { start: MONTH_END, end: MONTH_END + 30 * DAY }, parent: { subscription_item_details: { proration: false } }, pricing: { price_details: { price: 'price_ai_m' } } }],
      })
    )
    expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
  })

  it('stacks with a discount: the discounted allowance is scaled the same way', async () => {
    await postUpdate({
      ...upgraded({ lines: [prorationLine('price_ai_m', 400, MONTH_END - 15 * DAY, MONTH_END)] }),
      discounts: [discount({ percent_off: 50 })],
    })
    expect(written().ai_monthly_credits).toBe(Math.floor(creditsForPayment(3.99) / 2))
  })

  // Measured in test mode (2026-10-26, test clock, a card that attaches but declines): the portal's
  // confirm page makes a failed upgrade a pending update. The old price stays, the subscription
  // stays active, and the latest invoice is the open `subscription_update` invoice listing the new
  // price; paying it applies the price (pending_update_applied, then customer.subscription.updated
  // with that invoice paid); unpaid, the update expires after about 23 hours and the invoice goes void.
  describe('an upgrade invoice that is not paid', () => {
    it.each(['open', 'draft', 'void', 'uncollectible'])(
      'a mid-period upgrade into managed applied with its invoice %s: no credits until it is paid',
      async (status) => {
        await postUpdate(upgraded({ status, lines: [prorationLine('price_ai_m', 400, MONTH_END - 15 * DAY, MONTH_END)] }))
        expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: 0 })

        // Paid later: the next subscription write re-reads the invoice and grants the share.
        mockUpsert.mockClear()
        await postUpdate(upgraded({ lines: [prorationLine('price_ai_m', 400, MONTH_END - 15 * DAY, MONTH_END)] }))
        expect(written().ai_monthly_credits).toBe(1250)
      }
    )

    it.each(['open', 'void'])(
      'a failed portal upgrade (pending update, invoice %s) leaves the paid managed monthly plan its full allowance',
      async (status) => {
        // Managed monthly → managed yearly declined: the price is still price_ai_m, and the invoice
        // charges the yearly price (not the current one) against the unused monthly time.
        await postUpdate(
          upgraded({
            status,
            subtotal: 8212,
            lines: [
              prorationLine('price_ai_m', -387, MONTH_END - 15 * DAY, MONTH_END),
              fullLine('price_ai_y', 8599, MONTH_END - 15 * DAY, MONTH_END - 15 * DAY + 365 * DAY),
            ],
          })
        )
        expect(written()).toEqual({ ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS })
      }
    )

    it('a failed portal upgrade from Pro leaves the row on Pro with no credits', async () => {
      await postUpdate(
        upgraded({
          price: 'price_pro_m',
          status: 'open',
          lines: [
            prorationLine('price_pro_m', -193, MONTH_END - 15 * DAY, MONTH_END),
            prorationLine('price_ai_m', 387, MONTH_END - 15 * DAY, MONTH_END),
          ],
        })
      )
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ tier: 'pro', ai_monthly_credits: 0 })
    })

    it('a deferred change into managed landing at the renewal (full-price line, not paid yet) keeps the full allowance', async () => {
      // Like a renewal: the allowance stands while Stripe collects; a failed payment changes the
      // subscription's status, which is what removes access.
      await postUpdate(
        upgraded({ status: 'draft', subtotal: 799, lines: [fullLine('price_ai_m', 799, MONTH_END, MONTH_END + 30 * DAY)] })
      )
      expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
    })
  })

  // The upgrade invoice's subtotal nets the new price's charge against the old price's unused time,
  // so a discount measured against it reads far larger than it is. The charged share comes from the
  // current price's own line instead.
  describe('a discount on an upgrade invoice is measured on the new price’s line', () => {
    const HALF = MONTH_END - 15 * DAY
    /** The allowance `cents` a month funds, scaled to the half month the upgrade charged for. */
    const halfOf = (cents: number) => Math.floor(monthlyAllowanceForPayment(cents / 100, 1) * 0.5)

    it('a 20% managed-only coupon, as the pinned API version shows it: 0.8 × the time share', async () => {
      // Test mode, 2026-10-26 (own key → managed, 15 days left, a 20% coupon restricted to the
      // managed product): Stripe puts the discount inside the proration line's amount (387 → 310)
      // and reports discount_amounts of 0; the old price's line isn't discounted.
      await postUpdate({
        ...upgraded({
          subtotal: 20,
          total_discount_amounts: [{ amount: 0, discount: 'di_1' }],
          lines: [
            { ...prorationLine('price_byok_m', -290, HALF, MONTH_END), discount_amounts: [{ amount: 0, discount: 'di_1' }] },
            { ...prorationLine('price_ai_m', 310, HALF, MONTH_END), discount_amounts: [{ amount: 0, discount: 'di_1' }] },
          ],
        }),
        discounts: [discount({ percent_off: 20, applies_to: { products: ['prod_managed'] } })],
      })
      expect(written().ai_monthly_credits).toBe(halfOf(Math.floor(799 * 0.8)))
    })

    it('a 20% discount reported on the proration line (coupon already gone): 0.8 × the time share, not the net subtotal’s', async () => {
      // 400 charged with 80 of it discounted, against a 300 credit: the subtotal is 100, so a share
      // taken from it would be 0.2.
      await postUpdate(
        upgraded({
          subtotal: 100,
          total_discount_amounts: [{ amount: 80, discount: 'di_1' }],
          lines: [
            prorationLine('price_byok_m', -300, HALF, MONTH_END),
            { ...prorationLine('price_ai_m', 400, HALF, MONTH_END), discount_amounts: [{ amount: 80, discount: 'di_1' }] },
          ],
        })
      )
      expect(written().ai_monthly_credits).toBe(halfOf(Math.floor(799 * 0.8)))
      expect(written().ai_monthly_credits).toBeGreaterThan(halfOf(Math.floor(799 * 0.2)))
    })

    it('a line discount equal to the whole net subtotal no longer zeroes the allowance', async () => {
      await postUpdate(
        upgraded({
          subtotal: 100,
          total_discount_amounts: [{ amount: 100, discount: 'di_1' }],
          lines: [
            prorationLine('price_byok_m', -300, HALF, MONTH_END),
            { ...prorationLine('price_ai_m', 400, HALF, MONTH_END), discount_amounts: [{ amount: 100, discount: 'di_1' }] },
          ],
        })
      )
      expect(written().ai_monthly_credits).toBe(halfOf(Math.floor(799 * 0.75)))
    })

    it('monthly → yearly into managed (a full yearly line): the line’s own discount share, full allowance otherwise', async () => {
      await postUpdate(
        upgraded({
          price: 'price_ai_y',
          end: YEAR_END,
          subtotal: 8299,
          total_discount_amounts: [{ amount: 1720, discount: 'di_1' }],
          lines: [prorationLine('price_byok_m', -300, START, START + 15 * DAY), fullLine('price_ai_y', 8599, START, YEAR_END, 1720)],
        })
      )
      expect(written().ai_monthly_credits).toBe(monthlyAllowanceForPayment(Math.floor(8599 * 0.8) / 100, 12))
    })

    it('an invoice that is not a plan change is still measured on its subtotal', async () => {
      await postUpdate(
        upgraded({
          billing_reason: 'subscription_cycle',
          subtotal: 799,
          total_discount_amounts: [{ amount: 400, discount: 'di_1' }],
          lines: [fullLine('price_ai_m', 799, MONTH_END, MONTH_END + 30 * DAY, 400)],
        })
      )
      expect(written().ai_monthly_credits).toBe(creditsForPayment(3.99))
    })
  })

  // Dunning: Stripe retries a failed renewal while the subscription is past_due (no credits, see
  // the first describe). When a retry succeeds it is active again and the allowance is worked
  // out as usual from its latest invoice.
  describe('a failed renewal that recovers', () => {
    const renewal = (status: string) => ({
      billing_reason: 'subscription_cycle',
      status,
      subtotal: 799,
      lines: [fullLine('price_ai_m', 799, MONTH_END, MONTH_END + 30 * DAY)],
    })

    it('past_due with the renewal invoice open: 0; paid and active again: the full allowance', async () => {
      await postUpdate({ ...upgraded(renewal('open')), status: 'past_due' })
      expect(written().ai_monthly_credits).toBe(0)

      mockUpsert.mockClear()
      await postUpdate(upgraded(renewal('paid')))
      expect(written().ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
    })

    it('recovering while the latest invoice is still a mid-period upgrade keeps that upgrade’s share', async () => {
      const sub = upgraded({ lines: [prorationLine('price_ai_m', 400, MONTH_END - 15 * DAY, MONTH_END)] })
      await postUpdate({ ...sub, status: 'past_due' })
      expect(written().ai_monthly_credits).toBe(0)

      mockUpsert.mockClear()
      await postUpdate(sub)
      expect(written().ai_monthly_credits).toBe(1250)
    })
  })
})
