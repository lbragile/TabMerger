/**
 * The Billing Portal configuration cache in lib/stripe.ts (cachedPortalConfiguration()), through
 * the two flows that use it: the cancellation configuration (createCancelSubscriptionSession()) and
 * the per-target plan-change configurations (createPlanSwitchSession()). An id is reused for
 * PORTAL_CONFIGURATION_TTL_MS (10 minutes), then looked up again, so a configuration edited in the
 * Dashboard is caught by the feature check within that time; concurrent first requests on one
 * instance share a single lookup; a failed lookup isn't cached. The Stripe SDK is mocked and the
 * clock is faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsList: vi.fn(),
  portalCreate: vi.fn(),
  configList: vi.fn(),
  configCreate: vi.fn(),
  priceRetrieve: vi.fn(),
  invoicePreview: vi.fn(),
}))

vi.mock('stripe', () => ({
  default: class {
    subscriptions = { retrieve: m.subscriptionsRetrieve, list: m.subscriptionsList }
    prices = { retrieve: m.priceRetrieve }
    invoices = { createPreview: m.invoicePreview }
    billingPortal = {
      sessions: { create: m.portalCreate },
      configurations: { list: m.configList, create: m.configCreate },
    }
  },
}))

/** The cancellation configuration as Stripe lists it; `cancel` overrides its cancel feature. */
const cancelConfig = (id: string, cancel: Record<string, unknown> = {}) => ({
  id,
  metadata: { tabmerger_cancel: 'v1' },
  features: {
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none', ...cancel },
    subscription_update: { enabled: false },
  },
})

const cancelArgs = { customerId: 'cus_1', subscriptionId: 'sub_1', returnUrl: 'https://tabmerger.app/account' }
const configurationsUsed = () => m.portalCreate.mock.calls.map(([params]) => params.configuration)

const MINUTE = 60 * 1000

describe('portal configuration cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
    vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
    vi.stubEnv('STRIPE_PRO_YEARLY_PRICE_ID', 'price_pro_y')
    m.subscriptionsRetrieve.mockResolvedValue({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      cancel_at: null,
    })
    m.portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/x' })
    m.configList.mockResolvedValue({ data: [cancelConfig('bpc_cancel')], has_more: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is 10 minutes', async () => {
    const { PORTAL_CONFIGURATION_TTL_MS } = await import('@/lib/stripe')
    expect(PORTAL_CONFIGURATION_TTL_MS).toBe(10 * MINUTE)
  })

  it('reuses the cancellation configuration id within the TTL, without listing again', async () => {
    const { createCancelSubscriptionSession } = await import('@/lib/stripe')
    await createCancelSubscriptionSession(cancelArgs)
    vi.advanceTimersByTime(10 * MINUTE - 1)
    await createCancelSubscriptionSession(cancelArgs)

    expect(m.configList).toHaveBeenCalledTimes(1)
    expect(configurationsUsed()).toEqual(['bpc_cancel', 'bpc_cancel'])
  })

  it('looks it up again after the TTL and catches a Dashboard edit: the edited one is skipped and a new one made', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { createCancelSubscriptionSession } = await import('@/lib/stripe')
    await createCancelSubscriptionSession(cancelArgs)

    // Someone turns on prorated (immediate) cancellation in the Dashboard.
    m.configList.mockResolvedValue({ data: [cancelConfig('bpc_cancel', { mode: 'immediately' })], has_more: false })
    m.configCreate.mockResolvedValue({ id: 'bpc_cancel_new' })
    vi.advanceTimersByTime(10 * MINUTE)
    await createCancelSubscriptionSession(cancelArgs)

    expect(m.configList).toHaveBeenCalledTimes(2)
    expect(m.configCreate).toHaveBeenCalledTimes(1)
    expect(configurationsUsed()).toEqual(['bpc_cancel', 'bpc_cancel_new'])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('configuration bpc_cancel (cancellation)'))

    // The new id is cached in turn.
    await createCancelSubscriptionSession(cancelArgs)
    expect(m.configList).toHaveBeenCalledTimes(2)
    expect(configurationsUsed()).toEqual(['bpc_cancel', 'bpc_cancel_new', 'bpc_cancel_new'])
  })

  it('shares one lookup between concurrent cold-start requests, so only one configuration is made', async () => {
    m.configList.mockResolvedValue({ data: [], has_more: false })
    let created = 0
    m.configCreate.mockImplementation(async () => ({ id: `bpc_made_${++created}` }))
    const { createCancelSubscriptionSession } = await import('@/lib/stripe')

    await Promise.all([1, 2, 3, 4, 5].map(() => createCancelSubscriptionSession(cancelArgs)))

    expect(m.configList).toHaveBeenCalledTimes(1)
    expect(m.configCreate).toHaveBeenCalledTimes(1)
    expect(new Set(configurationsUsed())).toEqual(new Set(['bpc_made_1']))
  })

  it('caches nothing when the lookup fails: the next request tries again', async () => {
    m.configList.mockRejectedValueOnce(Object.assign(new Error('Server error'), { type: 'StripeAPIError' }))
    const { createCancelSubscriptionSession } = await import('@/lib/stripe')

    await expect(createCancelSubscriptionSession(cancelArgs)).rejects.toThrow('Server error')
    await createCancelSubscriptionSession(cancelArgs)

    expect(m.configList).toHaveBeenCalledTimes(2)
    expect(configurationsUsed()).toEqual(['bpc_cancel'])
  })

  it('gives each plan-change target its own entry, also re-checked after the TTL', async () => {
    m.subscriptionsList.mockResolvedValue({
      data: [{ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_pro_m' } }] } }],
    })
    m.priceRetrieve.mockImplementation(async (id: string) => ({ id, active: true, product: 'prod_pro' }))
    m.invoicePreview.mockResolvedValue({ total: 2900 })
    m.configList.mockResolvedValue({ data: [], has_more: false })
    let created = 0
    m.configCreate.mockImplementation(async () => ({ id: `bpc_plan_${++created}` }))
    const { createPlanSwitchSession } = await import('@/lib/stripe')
    const switchTo = () =>
      createPlanSwitchSession({
        customerId: 'cus_1',
        targetPriceId: 'price_pro_y',
        planPriceIds: ['price_pro_m', 'price_pro_y'],
        returnUrl: 'https://tabmerger.app/account',
      })

    await switchTo()
    vi.advanceTimersByTime(5 * MINUTE)
    await switchTo()
    expect(m.configList).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * MINUTE)
    await switchTo()
    expect(m.configList).toHaveBeenCalledTimes(2)
    // Nothing tagged was listed, so the lookup made another (a real one would find bpc_plan_1).
    expect(configurationsUsed()).toEqual(['bpc_plan_1', 'bpc_plan_1', 'bpc_plan_2'])
  })
})
