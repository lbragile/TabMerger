/**
 * Tests for createPlanSwitchSession in lib/stripe.ts: which subscription it moves, and how each
 * change is applied under the refund policy (upgrades now and prorated, downgrades at the end of
 * the paid period with no proration). The Stripe SDK itself is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSubscriptionsList = vi.fn()
const mockPortalCreate = vi.fn()
const mockSubscriptionsUpdate = vi.fn()
const mockScheduleCreate = vi.fn()
const mockScheduleUpdate = vi.fn()
const mockScheduleRelease = vi.fn()
const mockPriceRetrieve = vi.fn()
const mockConfigList = vi.fn()
const mockConfigCreate = vi.fn()
const mockInvoicePreview = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockCouponRetrieve = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: mockSubscriptionsList, update: mockSubscriptionsUpdate, retrieve: mockSubscriptionsRetrieve }
    invoices = { createPreview: mockInvoicePreview }
    coupons = { retrieve: mockCouponRetrieve }
    billingPortal = {
      sessions: { create: mockPortalCreate },
      configurations: { list: mockConfigList, create: mockConfigCreate },
    }
    prices = { retrieve: mockPriceRetrieve }
    subscriptionSchedules = {
      create: mockScheduleCreate,
      update: mockScheduleUpdate,
      release: mockScheduleRelease,
    }
  },
}))

const sub = (id: string, status: string, priceId: string, itemId = `si_${id}`) => ({
  id,
  status,
  items: { data: [{ id: itemId, price: { id: priceId } }] },
})

/**
 * A portal configuration as Stripe lists it (products expanded), with the features
 * planChangePortalConfiguration() makes for `price`; `update` / `cancel` override parts of them.
 */
const planChangeConfig = (
  id: string,
  key: string,
  price = 'price_pro_y',
  update: Record<string, unknown> = {},
  cancel: Record<string, unknown> = {}
) => ({
  id,
  metadata: { tabmerger_plan_change: key },
  features: {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'always_invoice',
      schedule_at_period_end: { conditions: [{ type: 'shortening_interval' }, { type: 'decreasing_item_amount' }] },
      products: [{ product: `prod_of_${price}`, prices: [price], adjustable_quantity: { enabled: false, maximum: null, minimum: 1 } }],
      ...update,
    },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', ...cancel },
  },
})

const args = {
  customerId: 'cus_1',
  targetPriceId: 'price_pro_y',
  planPriceIds: ['price_pro_m', 'price_pro_y'],
  returnUrl: 'https://tabmerger.app/account',
}

describe('createPlanSwitchSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
    vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_y')
    vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
    vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
    vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' })
    mockPriceRetrieve.mockImplementation(async (id: string) => ({ id, active: true, product: `prod_of_${id}` }))
    mockConfigList.mockResolvedValue({ data: [] })
    mockConfigCreate.mockResolvedValue({ id: 'bpc_target' })
    // An upgrade's previewed invoice: a charge.
    mockInvoicePreview.mockResolvedValue({ total: 2900 })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('opens the confirm-plan-change flow for the paid subscription, swapping only its price', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [sub('sub_old', 'canceled', 'price_pro_m'), sub('sub_live', 'active', 'price_pro_m')],
    })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    const result = await createPlanSwitchSession(args)

    expect(result).toEqual({ kind: 'portal', url: 'https://billing.stripe.com/p/session/x' })
    expect(mockSubscriptionsList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 10 })
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://tabmerger.app/account',
      locale: 'en-CA',
      configuration: 'bpc_target',
      flow_data: {
        type: 'subscription_update_confirm',
        subscription_update_confirm: {
          subscription: 'sub_live',
          items: [{ id: 'si_sub_live', price: 'price_pro_y', quantity: 1 }],
        },
        after_completion: { type: 'redirect', redirect: { return_url: 'https://tabmerger.app/account' } },
      },
    })
  })

  it('makes a portal configuration that lists only the target price, so the session allows no other change', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'past_due', 'price_pro_m')] })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)

    expect(mockConfigList).toHaveBeenCalledWith({
      active: true,
      is_default: false,
      limit: 100,
      expand: ['data.features.subscription_update.products'],
    })
    expect(mockConfigCreate).toHaveBeenCalledWith({
      name: 'TabMerger plan change to price_pro_y (v3)',
      metadata: { tabmerger_plan_change: 'v3:price_pro_y' },
      features: {
        subscription_update: {
          enabled: true,
          // No promotion codes: a code on the confirm page could turn an upgrade into a credit.
          default_allowed_updates: ['price'],
          proration_behavior: 'always_invoice',
          schedule_at_period_end: {
            conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }],
          },
          products: [{ product: 'prod_of_price_pro_y', prices: ['price_pro_y'], adjustable_quantity: { enabled: false } }],
        },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
      },
    })
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_target' }))
  })

  it('reuses a configuration found by its metadata, then from memory', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
    mockConfigList.mockResolvedValue({
      data: [
        planChangeConfig('bpc_other', 'v3:price_ai_m', 'price_ai_m'),
        // Older versions (v1: shortening_interval only; v2: promotion codes on) are never reused.
        planChangeConfig('bpc_v1', 'v1:price_pro_y'),
        planChangeConfig('bpc_v2', 'v2:price_pro_y'),
        planChangeConfig('bpc_found', 'v3:price_pro_y'),
      ],
    })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)
    await createPlanSwitchSession(args)

    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockConfigList).toHaveBeenCalledTimes(1)
    expect(mockPortalCreate).toHaveBeenLastCalledWith(expect.objectContaining({ configuration: 'bpc_found' }))
  })

  it('pages through the whole configuration list to find it', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
    mockConfigList
      .mockResolvedValueOnce({ data: [planChangeConfig('bpc_a', 'v3:price_ai_m', 'price_ai_m'), planChangeConfig('bpc_b', 'v2:price_pro_y')], has_more: true })
      .mockResolvedValueOnce({ data: [planChangeConfig('bpc_page2', 'v3:price_pro_y')], has_more: false })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)

    expect(mockConfigList).toHaveBeenCalledTimes(2)
    expect(mockConfigList.mock.calls[1][0]).toEqual({
      active: true,
      is_default: false,
      limit: 100,
      expand: ['data.features.subscription_update.products'],
      starting_after: 'bpc_b',
    })
    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_page2' }))
  })

  // A configuration with our metadata whose features were changed (in the Dashboard, by hand) is
  // never used: a session on it could apply a downgrade at once, take a promotion code, or list
  // another price. A new one is made instead and the skipped one is logged by id.
  it.each([
    ['subscription updates turned off', { enabled: false }, {}],
    ['promotion codes allowed', { default_allowed_updates: ['price', 'promotion_code'] }, {}],
    ['quantities allowed', { default_allowed_updates: ['price', 'quantity'] }, {}],
    ['create_prorations instead of always_invoice', { proration_behavior: 'create_prorations' }, {}],
    ['the decreasing_item_amount condition removed', { schedule_at_period_end: { conditions: [{ type: 'shortening_interval' }] } }, {}],
    ['no deferral conditions', { schedule_at_period_end: { conditions: [] } }, {}],
    ['a second price listed', { products: [{ product: 'prod_of_price_pro_y', prices: ['price_pro_y', 'price_pro_m'], adjustable_quantity: { enabled: false } }] }, {}],
    ['another price listed', { products: [{ product: 'prod_of_price_pro_y', prices: ['price_pro_m'], adjustable_quantity: { enabled: false } }] }, {}],
    ['a second product listed', { products: [
      { product: 'prod_of_price_pro_y', prices: ['price_pro_y'], adjustable_quantity: { enabled: false } },
      { product: 'prod_of_price_ai_m', prices: ['price_ai_m'], adjustable_quantity: { enabled: false } },
    ] }, {}],
    ['the price on another product', { products: [{ product: 'prod_other', prices: ['price_pro_y'], adjustable_quantity: { enabled: false } }] }, {}],
    ['adjustable quantity on', { products: [{ product: 'prod_of_price_pro_y', prices: ['price_pro_y'], adjustable_quantity: { enabled: true } }] }, {}],
    ['products not returned', { products: undefined }, {}],
    ['immediate cancellation', {}, { mode: 'immediately' }],
    ['cancellation with proration', {}, { mode: 'immediately', proration_behavior: 'create_prorations' }],
  ])('a v3 configuration with %s is not reused: a new one is made', async (_label, update, cancel) => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
    mockConfigList.mockResolvedValue({ data: [planChangeConfig('bpc_edited', 'v3:price_pro_y', 'price_pro_y', update, cancel)] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)

    expect(mockConfigCreate).toHaveBeenCalledTimes(1)
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_target' }))
    expect(warn.mock.calls).toEqual([
      ['Billing portal: configuration bpc_edited (plan change) has the expected metadata but different features, so it is not used and a new one is made'],
    ])
    warn.mockRestore()
  })

  it('prefers a matching configuration over an edited one with the same metadata', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
    mockConfigList.mockResolvedValue({
      data: [
        planChangeConfig('bpc_edited', 'v3:price_pro_y', 'price_pro_y', { default_allowed_updates: ['price', 'promotion_code'] }),
        planChangeConfig('bpc_made_after', 'v3:price_pro_y'),
      ],
    })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)

    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_made_after' }))
  })

  it('refuses an archived target price (price_unavailable) without opening the portal', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
    mockPriceRetrieve.mockResolvedValue({ id: 'price_pro_y', active: false, product: 'prod_pro' })
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    const err = await createPlanSwitchSession(args).catch((e: unknown) => e)
    expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('price_unavailable')
    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('ignores subscriptions on other prices or without a paid status', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [sub('sub_legacy', 'active', 'price_legacy'), sub('sub_unpaid', 'unpaid', 'price_pro_m')],
    })
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    const err = await createPlanSwitchSession(args).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlanSwitchError)
    expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('no_subscription')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['no subscription at all', { data: [] }],
    ['only subscriptions that have ended for good', { data: [sub('sub_x', 'incomplete_expired', 'price_pro_m')], has_more: false }],
  ])('says no_entitled_subscription for %s', async (_label, listed) => {
    mockSubscriptionsList.mockResolvedValue(listed)
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    const err = await createPlanSwitchSession(args).catch((e: unknown) => e)
    expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('no_entitled_subscription')
  })

  it.each(['unpaid', 'paused', 'incomplete'])(
    'says open_subscription when a %s subscription can still be paid or resumed',
    async (status) => {
      mockSubscriptionsList.mockResolvedValue({
        data: [sub('sub_x', 'incomplete_expired', 'price_pro_m'), sub('sub_open', status, 'price_legacy')],
        has_more: false,
      })
      const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

      const err = await createPlanSwitchSession(args).catch((e: unknown) => e)
      expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('open_subscription')
      expect(mockPortalCreate).not.toHaveBeenCalled()
    }
  )

  it('says no_subscription, not no_entitled_subscription, when the list has more pages', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_unpaid', 'unpaid', 'price_pro_m')], has_more: true })
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    const err = await createPlanSwitchSession(args).catch((e: unknown) => e)
    expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('no_subscription')
  })

  it('says no_customer when Stripe has no such customer (resource_missing), and rethrows anything else', async () => {
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    mockSubscriptionsList.mockRejectedValueOnce(Object.assign(new Error('No such customer'), { code: 'resource_missing' }))
    const missing = await createPlanSwitchSession(args).catch((e: unknown) => e)
    expect((missing as InstanceType<typeof PlanSwitchError>).reason).toBe('no_customer')

    const outage = Object.assign(new Error('Server error'), { type: 'StripeAPIError' })
    mockSubscriptionsList.mockRejectedValueOnce(outage)
    expect(await createPlanSwitchSession(args).catch((e: unknown) => e)).toBe(outage)
  })

  it('refuses a switch to the price the subscription is already on', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_y')] })
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    const err = await createPlanSwitchSession(args).catch((e: unknown) => e)
    expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('already_on_price')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('refuses while a deferred switch (a subscription schedule) is pending', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [{ ...sub('sub_1', 'active', 'price_pro_y'), schedule: 'sub_sched_1' }],
    })
    const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

    const err = await createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m' }).catch((e: unknown) => e)
    expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('already_scheduled')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  describe('refund policy', () => {
    const PRO_AI = ['price_ai_m', 'price_ai_y', 'price_byok_m', 'price_byok_y']
    const PERIOD_START = 1_790_000_000
    const PERIOD_END = 1_792_592_000

    /** What subscriptionSchedules.create({ from_subscription }) returns: one phase, the current period. */
    function fromSubscriptionSchedule(price: string, extra: Record<string, unknown> = {}) {
      return {
        id: 'sub_sched_new',
        phases: [
          {
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: [{ price, quantity: 1 }],
            discounts: [],
            default_tax_rates: [],
            metadata: {},
            ...extra,
          },
        ],
      }
    }

    it('schedules Pro AI yearly → Pro monthly for the end of the paid period with no proration (no portal, no refund)', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_ai_y')] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_y'))
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({
        ...args,
        targetPriceId: 'price_pro_m',
        planPriceIds: PRO_AI,
      })

      expect(result).toEqual({ kind: 'scheduled', effectiveAt: PERIOD_END })
      expect(mockScheduleCreate).toHaveBeenCalledWith({ from_subscription: 'sub_1' })
      expect(mockScheduleUpdate).toHaveBeenCalledWith('sub_sched_new', {
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          {
            items: [{ price: 'price_ai_y', quantity: 1 }],
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            proration_behavior: 'none',
          },
          {
            items: [{ price: 'price_pro_m', quantity: 1 }],
            proration_behavior: 'none',
            // One second, as the portal's own deferred changes: the schedule releases the
            // subscription right after the price changes, so it isn't locked for a period.
            end_date: PERIOD_END + 1,
          },
        ],
      })
      expect(mockPortalCreate).not.toHaveBeenCalled()
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
      expect(mockScheduleRelease).not.toHaveBeenCalled()
    })

    it('keeps the current phase intact: discounts, tax rates and metadata are passed back', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_ai_y')] })
      mockScheduleCreate.mockResolvedValue(
        fromSubscriptionSchedule('price_ai_y', {
          discounts: [
            { discount: { id: 'di_1' }, coupon: 'co_1', promotion_code: null },
            { discount: null, coupon: 'co_2', promotion_code: null },
          ],
          default_tax_rates: [{ id: 'txr_1' }],
          metadata: { user_id: 'user-1' },
        })
      )
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      await createPlanSwitchSession({ ...args, targetPriceId: 'price_byok_m', planPriceIds: PRO_AI })

      const [, params] = mockScheduleUpdate.mock.calls[0]
      expect(params.phases[0]).toMatchObject({
        discounts: [{ discount: 'di_1' }, { coupon: 'co_2' }],
        default_tax_rates: ['txr_1'],
        metadata: { user_id: 'user-1' },
      })
      // Managed yearly → own key monthly shortens the interval too: the server schedules it, a
      // monthly phase with no proration.
      expect(params.phases[1]).toEqual({
        items: [{ price: 'price_byok_m', quantity: 1 }],
        proration_behavior: 'none',
        end_date: PERIOD_END + 1,
        default_tax_rates: ['txr_1'],
      })
    })

    // Downgrades whose interval doesn't shorten: Stripe's confirm page defers them itself, because
    // the configuration has decreasing_item_amount (verified across products in test mode,
    // 2026-10-26). Our server schedules nothing and changes nothing.
    it.each([
      ['managed → own key, monthly', 'price_ai_m', 'price_byok_m'],
      ['managed → own key, yearly', 'price_ai_y', 'price_byok_y'],
      ['managed monthly → own key yearly', 'price_ai_m', 'price_byok_y'],
      ['Pro AI → Pro, monthly', 'price_ai_m', 'price_pro_m'],
      ['Pro AI → Pro, yearly', 'price_ai_y', 'price_pro_y'],
      ['Pro AI monthly → Pro yearly', 'price_ai_m', 'price_pro_y'],
      ['own key → Pro, monthly', 'price_byok_m', 'price_pro_m'],
      ['own key → Pro, yearly', 'price_byok_y', 'price_pro_y'],
    ])('%s goes to the portal confirm page, whose conditions defer it to the period end', async (_l, from, to) => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', from)] })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: to, planPriceIds: PRO_AI })

      expect(result).toEqual({ kind: 'portal', url: 'https://billing.stripe.com/p/session/x' })
      const { features } = mockConfigCreate.mock.calls[0][0]
      expect(features.subscription_update).toMatchObject({
        default_allowed_updates: ['price'],
        proration_behavior: 'always_invoice',
        schedule_at_period_end: {
          conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }],
        },
        products: [{ product: `prod_of_${to}`, prices: [to], adjustable_quantity: { enabled: false } }],
      })
      expect(mockPortalCreate.mock.calls[0][0].flow_data).toMatchObject({
        type: 'subscription_update_confirm',
        subscription_update_confirm: { subscription: 'sub_1', items: [{ id: 'si_sub_1', price: to, quantity: 1 }] },
      })
      expect(mockScheduleCreate).not.toHaveBeenCalled()
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
    })

    it('schedules Pro yearly → Pro AI monthly on the server: the portal applied it at once with a -$35 credit', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_y')] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_pro_y'))
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m' })

      expect(result).toEqual({ kind: 'scheduled', effectiveAt: PERIOD_END })
      expect(mockScheduleUpdate.mock.calls[0][1].phases[1]).toEqual({
        items: [{ price: 'price_ai_m', quantity: 1 }],
        proration_behavior: 'none',
        end_date: PERIOD_END + 1,
      })
      expect(mockPortalCreate).not.toHaveBeenCalled()
      expect(mockConfigCreate).not.toHaveBeenCalled()
    })

    it('an own-key yearly → monthly switch goes to the portal, which defers it (own product)', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_byok_y')] })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_byok_m', planPriceIds: PRO_AI })

      expect(result.kind).toBe('portal')
      expect(mockScheduleCreate).not.toHaveBeenCalled()
    })

    it('a Pro yearly → monthly switch still goes to the portal, which defers it', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_y')] })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m' })

      expect(result.kind).toBe('portal')
      expect(mockScheduleCreate).not.toHaveBeenCalled()
    })

    it('Pro → Pro AI (managed) is an upgrade through the portal confirm flow', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m' })

      expect(result.kind).toBe('portal')
      expect(mockScheduleCreate).not.toHaveBeenCalled()
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
    })

    it.each([
      ['own key → managed', 'price_byok_m', 'price_ai_m', PRO_AI],
      ['own-key monthly → yearly', 'price_byok_m', 'price_byok_y', PRO_AI],
      ['Pro → Pro AI on your own key', 'price_pro_m', 'price_byok_m', ['price_pro_m', 'price_pro_y']],
    ])('%s is an upgrade confirmed on the portal page (charged there), never changed by our server', async (_l, from, to, plan) => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', from)] })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: to, planPriceIds: plan })

      expect(result).toEqual({ kind: 'portal', url: 'https://billing.stripe.com/p/session/x' })
      expect(mockConfigCreate.mock.calls[0][0].features.subscription_update.products).toEqual([
        { product: `prod_of_${to}`, prices: [to], adjustable_quantity: { enabled: false } },
      ])
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
      expect(mockScheduleCreate).not.toHaveBeenCalled()
    })

    it('refuses a downgrade with 409 already_scheduled while a schedule is pending, creating nothing', async () => {
      mockSubscriptionsList.mockResolvedValue({
        data: [{ ...sub('sub_1', 'active', 'price_ai_m'), schedule: 'sub_sched_1' }],
      })
      const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

      const err = await createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m', planPriceIds: PRO_AI }).catch(
        (e: unknown) => e
      )
      expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('already_scheduled')
      expect(mockScheduleCreate).not.toHaveBeenCalled()
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
    })

    it('refuses any change while the subscription is set to cancel', async () => {
      mockSubscriptionsList.mockResolvedValue({
        data: [{ ...sub('sub_1', 'active', 'price_ai_m'), cancel_at_period_end: true }],
      })
      const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

      const err = await createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m', planPriceIds: PRO_AI }).catch(
        (e: unknown) => e
      )
      expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('cancel_scheduled')
      expect(mockScheduleCreate).not.toHaveBeenCalled()
    })

    it("carries the subscription's discounts that apply to the new product into the new phase", async () => {
      mockSubscriptionsList.mockResolvedValue({
        data: [{ ...sub('sub_1', 'active', 'price_ai_y'), discounts: ['di_any', 'di_target', 'di_other', 'di_legacy'] }],
      })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_y'))
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      mockSubscriptionsRetrieve.mockResolvedValue({
        id: 'sub_1',
        discounts: [
          { id: 'di_any', source: { coupon: 'co_any' } },
          { id: 'di_target', source: { coupon: { id: 'co_target' } } },
          { id: 'di_other', source: { coupon: 'co_other' } },
          // Older API versions: a top-level coupon.
          { id: 'di_legacy', coupon: { id: 'co_legacy' } },
        ],
      })
      mockCouponRetrieve.mockImplementation(async (id: string) => ({
        id,
        applies_to:
          id === 'co_any' ? undefined : { products: id === 'co_other' ? ['prod_of_price_ai_y'] : ['prod_of_price_pro_m'] },
      }))
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      await createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m', planPriceIds: PRO_AI })

      expect(mockSubscriptionsRetrieve).toHaveBeenCalledWith('sub_1', { expand: ['discounts'] })
      expect(mockCouponRetrieve).toHaveBeenCalledWith('co_target', { expand: ['applies_to'] })
      // A coupon restricted to the old product stays behind; the rest go on by discount id.
      expect(mockScheduleUpdate.mock.calls[0][1].phases[1].discounts).toEqual([
        { discount: 'di_any' },
        { discount: 'di_target' },
        { discount: 'di_legacy' },
      ])
    })

    it('reads no discounts when the subscription has none', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [{ ...sub('sub_1', 'active', 'price_ai_y'), discounts: [] }] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_y'))
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      await createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m', planPriceIds: PRO_AI })

      expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
      expect(mockScheduleUpdate.mock.calls[0][1].phases[1]).not.toHaveProperty('discounts')
    })

    it('releases the schedule when a discount cannot be read', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSubscriptionsList.mockResolvedValue({ data: [{ ...sub('sub_1', 'active', 'price_ai_y'), discounts: ['di_1'] }] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_y'))
      mockScheduleRelease.mockResolvedValue({})
      mockSubscriptionsRetrieve.mockResolvedValue({ id: 'sub_1', discounts: [{ id: 'di_1', source: { coupon: 'co_gone' } }] })
      mockCouponRetrieve.mockRejectedValue(new Error('No such coupon'))
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      await expect(
        createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m', planPriceIds: PRO_AI })
      ).rejects.toThrow('No such coupon')
      expect(mockScheduleUpdate).not.toHaveBeenCalled()
      expect(mockScheduleRelease).toHaveBeenCalledWith('sub_sched_new')
    })

    describe('upgrade invoice preview', () => {
      it('previews the upgrade as the confirm page would charge it, before opening the portal', async () => {
        mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
        const { createPlanSwitchSession } = await import('@/lib/stripe')

        const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m' })

        expect(result.kind).toBe('portal')
        expect(mockInvoicePreview).toHaveBeenCalledWith({
          customer: 'cus_1',
          subscription: 'sub_1',
          subscription_details: {
            items: [{ id: 'si_sub_1', price: 'price_ai_m', quantity: 1 }],
            proration_behavior: 'always_invoice',
          },
        })
        expect(mockInvoicePreview.mock.invocationCallOrder[0]).toBeLessThan(mockPortalCreate.mock.invocationCallOrder[0])
      })

      it('lets a zero total through (nothing is credited)', async () => {
        mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
        mockInvoicePreview.mockResolvedValue({ total: 0 })
        const { createPlanSwitchSession } = await import('@/lib/stripe')

        expect((await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m' })).kind).toBe('portal')
      })

      it('refuses an upgrade whose invoice would be a credit (would_credit), opening nothing', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_byok_m')] })
        mockInvoicePreview.mockResolvedValue({ total: -150 })
        const { createPlanSwitchSession, PlanSwitchError } = await import('@/lib/stripe')

        const err = await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m', planPriceIds: PRO_AI }).catch(
          (e: unknown) => e
        )

        expect((err as InstanceType<typeof PlanSwitchError>).reason).toBe('would_credit')
        expect(mockConfigCreate).not.toHaveBeenCalled()
        expect(mockPortalCreate).not.toHaveBeenCalled()
        expect(String(warn.mock.calls[0][0])).toContain('total is -150')
      })

      it('fails closed: a failed preview is rethrown and no portal session is made', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_m')] })
        const outage = Object.assign(new Error('Server error'), { type: 'StripeAPIError' })
        mockInvoicePreview.mockRejectedValue(outage)
        const { createPlanSwitchSession } = await import('@/lib/stripe')

        expect(await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m' }).catch((e: unknown) => e)).toBe(outage)
        expect(mockPortalCreate).not.toHaveBeenCalled()
        expect(String(error.mock.calls[0][0])).toMatch(/previewing the upgrade invoice .* failed/)
      })

      it.each([
        ['a downgrade the portal defers', 'price_ai_m', 'price_pro_m'],
        ['a yearly → monthly switch the portal defers', 'price_pro_y', 'price_pro_m'],
      ])('is not run for %s (it would preview an immediate change that never happens)', async (_l, from, to) => {
        mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', from)] })
        const { createPlanSwitchSession } = await import('@/lib/stripe')

        await createPlanSwitchSession({ ...args, targetPriceId: to, planPriceIds: [...PRO_AI, 'price_pro_m', 'price_pro_y'] })

        expect(mockInvoicePreview).not.toHaveBeenCalled()
        expect(mockPortalCreate).toHaveBeenCalled()
      })
    })

    it('releases the new schedule when the update fails, so the subscription is not left locked', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_ai_y')] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_y'))
      mockScheduleUpdate.mockRejectedValue(new Error('stripe down'))
      mockScheduleRelease.mockResolvedValue({})
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      await expect(
        createPlanSwitchSession({ ...args, targetPriceId: 'price_pro_m', planPriceIds: PRO_AI })
      ).rejects.toThrow('stripe down')
      expect(mockScheduleRelease).toHaveBeenCalledWith('sub_sched_new')
    })
  })

  it('throws a config error without calling Stripe when no secret key is set', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await expect(createPlanSwitchSession(args)).rejects.toThrow(/not configured/)
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
  })
})
