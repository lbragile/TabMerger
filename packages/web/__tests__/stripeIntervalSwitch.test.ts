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

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: mockSubscriptionsList, update: mockSubscriptionsUpdate }
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

    expect(mockConfigList).toHaveBeenCalledWith({ active: true, is_default: false, limit: 100 })
    expect(mockConfigCreate).toHaveBeenCalledWith({
      name: 'TabMerger plan change to price_pro_y (v1)',
      metadata: { tabmerger_plan_change: 'v1:price_pro_y' },
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price', 'promotion_code'],
          proration_behavior: 'always_invoice',
          schedule_at_period_end: { conditions: [{ type: 'shortening_interval' }] },
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
        { id: 'bpc_other', metadata: { tabmerger_plan_change: 'v1:price_ai_m' } },
        { id: 'bpc_found', metadata: { tabmerger_plan_change: 'v1:price_pro_y' } },
      ],
    })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)
    await createPlanSwitchSession(args)

    expect(mockConfigCreate).not.toHaveBeenCalled()
    expect(mockConfigList).toHaveBeenCalledTimes(1)
    expect(mockPortalCreate).toHaveBeenLastCalledWith(expect.objectContaining({ configuration: 'bpc_found' }))
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

    it('schedules Pro AI → Pro for the end of the paid period with no proration (no portal, no refund)', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_ai_y')] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_y'))
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({
        ...args,
        targetPriceId: 'price_pro_y',
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
            items: [{ price: 'price_pro_y', quantity: 1 }],
            proration_behavior: 'none',
            duration: { interval: 'year', interval_count: 1 },
          },
        ],
      })
      expect(mockPortalCreate).not.toHaveBeenCalled()
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled()
      expect(mockScheduleRelease).not.toHaveBeenCalled()
    })

    it('keeps the current phase intact: discounts, tax rates and metadata are passed back', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_ai_m')] })
      mockScheduleCreate.mockResolvedValue(
        fromSubscriptionSchedule('price_ai_m', {
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
      // Managed → own key is a downgrade: monthly phase, no proration.
      expect(params.phases[1]).toEqual({
        items: [{ price: 'price_byok_m', quantity: 1 }],
        proration_behavior: 'none',
        duration: { interval: 'month', interval_count: 1 },
      })
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

    it('releases the new schedule when the update fails, so the subscription is not left locked', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_ai_m')] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_ai_m'))
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
