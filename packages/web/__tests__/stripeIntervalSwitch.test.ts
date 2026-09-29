/**
 * Tests for createIntervalSwitchSession in lib/stripe.ts: which subscription it moves and the
 * Billing Portal flow it opens. The Stripe SDK itself is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSubscriptionsList = vi.fn()
const mockPortalCreate = vi.fn()

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { list: mockSubscriptionsList }
    billingPortal = { sessions: { create: mockPortalCreate } }
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

describe('createIntervalSwitchSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('opens the confirm-plan-change flow for the paid subscription, swapping only its price', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [sub('sub_old', 'canceled', 'price_pro_m'), sub('sub_live', 'active', 'price_pro_m')],
    })
    const { createIntervalSwitchSession } = await import('@/lib/stripe')

    const url = await createIntervalSwitchSession(args)

    expect(url).toBe('https://billing.stripe.com/p/session/x')
    expect(mockSubscriptionsList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 10 })
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://tabmerger.app/account',
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
    const { createIntervalSwitchSession } = await import('@/lib/stripe')

    await createIntervalSwitchSession(args)

    expect(mockPortalCreate).toHaveBeenCalledWith(expect.objectContaining({ configuration: 'bpc_switch' }))
  })

  it('ignores subscriptions on other prices or without a paid status', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [sub('sub_legacy', 'active', 'price_legacy'), sub('sub_unpaid', 'unpaid', 'price_pro_m')],
    })
    const { createIntervalSwitchSession, IntervalSwitchError } = await import('@/lib/stripe')

    const err = await createIntervalSwitchSession(args).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IntervalSwitchError)
    expect((err as InstanceType<typeof IntervalSwitchError>).reason).toBe('no_subscription')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('refuses a switch to the price the subscription is already on', async () => {
    mockSubscriptionsList.mockResolvedValue({ data: [sub('sub_1', 'active', 'price_pro_y')] })
    const { createIntervalSwitchSession, IntervalSwitchError } = await import('@/lib/stripe')

    const err = await createIntervalSwitchSession(args).catch((e: unknown) => e)
    expect((err as InstanceType<typeof IntervalSwitchError>).reason).toBe('already_on_price')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('refuses while a deferred switch (a subscription schedule) is pending', async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [{ ...sub('sub_1', 'active', 'price_pro_y'), schedule: 'sub_sched_1' }],
    })
    const { createIntervalSwitchSession, IntervalSwitchError } = await import('@/lib/stripe')

    const err = await createIntervalSwitchSession({ ...args, targetPriceId: 'price_pro_m' }).catch((e: unknown) => e)
    expect((err as InstanceType<typeof IntervalSwitchError>).reason).toBe('already_scheduled')
    expect(mockPortalCreate).not.toHaveBeenCalled()
  })

  it('throws a config error without calling Stripe when no secret key is set', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const { createIntervalSwitchSession } = await import('@/lib/stripe')

    await expect(createIntervalSwitchSession(args)).rejects.toThrow(/not configured/)
    expect(mockSubscriptionsList).not.toHaveBeenCalled()
  })
})
