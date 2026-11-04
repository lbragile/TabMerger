/**
 * getPendingPlanChange() in lib/stripe.ts: the plan change waiting in a subscription's schedule,
 * which the account page shows next to its Cancel button. Shapes follow the schedules Stripe made
 * in test mode on 2026-10-26 (the portal's and the server's: the current phase to the period end,
 * then the target price for one second). The Stripe SDK is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockRetrieve = vi.fn()
vi.mock('stripe', () => ({
  default: class {
    subscriptions = { retrieve: mockRetrieve }
  },
}))

const END = 1_795_757_962
const schedule = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_sched_1',
  status: 'active',
  current_phase: { start_date: END - 2_678_400, end_date: END },
  phases: [
    { start_date: END - 2_678_400, end_date: END, items: [{ price: 'price_ai_m' }] },
    { start_date: END, end_date: END + 1, items: [{ price: 'price_byok_m' }] },
  ],
  ...overrides,
})
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  items: { data: [{ price: { id: 'price_ai_m' }, current_period_end: END }] },
  schedule: schedule(),
  ...overrides,
})
const args = { customerId: 'cus_1', subscriptionId: 'sub_1' }

describe('getPendingPlanChange', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy')
  })
  afterEach(() => vi.unstubAllEnvs())

  it("returns the next phase's price and start", async () => {
    mockRetrieve.mockResolvedValue(subscription())
    const { getPendingPlanChange } = await import('@/lib/stripe')

    expect(await getPendingPlanChange(args)).toEqual({ priceId: 'price_byok_m', effectiveAt: END })
    expect(mockRetrieve).toHaveBeenCalledWith('sub_1', { expand: ['schedule'] })
  })

  it.each([
    ['no schedule', { schedule: null }],
    ['a released schedule', { schedule: schedule({ status: 'released' }) }],
    ['a next phase on the same price', { schedule: schedule({ phases: [schedule().phases[0], { start_date: END, end_date: END + 1, items: [{ price: 'price_ai_m' }] }] }) }],
    ["another customer's subscription", { customer: 'cus_other' }],
  ])('is null for %s', async (_label, overrides) => {
    mockRetrieve.mockResolvedValue(subscription(overrides))
    const { getPendingPlanChange } = await import('@/lib/stripe')
    expect(await getPendingPlanChange(args)).toBeNull()
  })

  it('reads nothing when Stripe is not configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const { getPendingPlanChange } = await import('@/lib/stripe')
    expect(await getPendingPlanChange(args)).toBeNull()
    expect(mockRetrieve).not.toHaveBeenCalled()
  })
})
