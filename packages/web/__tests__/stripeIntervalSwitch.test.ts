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

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: mockSubscriptionsList, update: mockSubscriptionsUpdate }
    billingPortal = { sessions: { create: mockPortalCreate } }
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

  it('uses STRIPE_PORTAL_CONFIGURATION_ID when set', async () => {
    vi.stubEnv('STRIPE_PORTAL_CONFIGURATION_ID', 'bpc_switch')
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'past_due', 'price_pro_m')] })
    const { createPlanSwitchSession } = await import('@/lib/stripe')

    await createPlanSwitchSession(args)

    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_switch' }))
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

    it('schedules an own-key yearly → monthly switch (the portal cannot list own-key prices)', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_byok_y')] })
      mockScheduleCreate.mockResolvedValue(fromSubscriptionSchedule('price_byok_y'))
      mockScheduleUpdate.mockResolvedValue({ id: 'sub_sched_new' })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_byok_m', planPriceIds: PRO_AI })

      expect(result).toEqual({ kind: 'scheduled', effectiveAt: PERIOD_END })
      expect(mockPortalCreate).not.toHaveBeenCalled()
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

    it('own key → managed is applied now with a prorated charge (always_invoice), only once paid', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_byok_m')] })
      mockSubscriptionsUpdate.mockResolvedValue({ id: 'sub_1', pending_update: null, latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/x' } })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_ai_m', planPriceIds: PRO_AI })

      expect(result).toEqual({ kind: 'applied_now', url: null })
      expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_1', {
        items: [{ id: 'si_sub_1', price: 'price_ai_m', quantity: 1 }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice'],
      })
      expect(mockPortalCreate).not.toHaveBeenCalled()
      expect(mockScheduleCreate).not.toHaveBeenCalled()
    })

    it('an own-key monthly → yearly switch is applied now; a pending payment returns the invoice page', async () => {
      mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_byok_m')] })
      mockSubscriptionsUpdate.mockResolvedValue({
        id: 'sub_1',
        pending_update: { expires_at: 1 },
        latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/i/x' },
      })
      const { createPlanSwitchSession } = await import('@/lib/stripe')

      const result = await createPlanSwitchSession({ ...args, targetPriceId: 'price_byok_y', planPriceIds: PRO_AI })

      expect(result).toEqual({ kind: 'applied_now', url: 'https://invoice.stripe.com/i/x' })
      expect(mockSubscriptionsUpdate).toHaveBeenCalledWith(
        'sub_1',
        expect.objectContaining({ proration_behavior: 'always_invoice' })
      )
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
