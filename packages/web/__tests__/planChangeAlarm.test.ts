/**
 * The plan-change alarm (lib/planChangeAlarm.ts): a log-only check on `customer.subscription.updated`
 * for what the refund policy forbids, a plan lowered at once and a plan change that leaves a credit.
 * The event shapes follow what Stripe sent in test mode on 2026-10-26: a portal-deferred change
 * lands with its schedule still attached and `previous_attributes` naming items, plan and
 * latest_invoice; an immediate cheaper change makes a `subscription_update` invoice with a negative
 * total (Pro yearly → Pro AI monthly: -$35.00).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { flushPlanChangeAlarms, logPlanChangeAlarm, planChangeAlarms } from '@/lib/planChangeAlarm'

const { mockCaptureMessage, mockFlush } = vi.hoisted(() => ({
  mockCaptureMessage: vi.fn(),
  mockFlush: vi.fn().mockResolvedValue(true),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage: mockCaptureMessage, flush: mockFlush }))

const PRICES = {
  STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro_m',
  STRIPE_PRO_YEARLY_PRICE_ID: 'price_pro_y',
  STRIPE_PRO_AI_MONTHLY_PRICE_ID: 'price_ai_m',
  STRIPE_PRO_AI_YEARLY_PRICE_ID: 'price_ai_y',
  STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID: 'price_byok_m',
  STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID: 'price_byok_y',
}

beforeEach(() => {
  for (const [name, value] of Object.entries(PRICES)) vi.stubEnv(name, value)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function subscription(price: string, extra: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    schedule: null,
    latest_invoice: 'in_new',
    items: { data: [{ price: { id: price } }] },
    ...extra,
  } as unknown as Stripe.Subscription
}

function invoice(extra: Record<string, unknown> = {}): Stripe.Invoice {
  return {
    id: 'in_new',
    billing_reason: 'subscription_update',
    total: 4300,
    starting_balance: 0,
    ending_balance: 0,
    ...extra,
  } as unknown as Stripe.Invoice
}

/** The price change as `previous_attributes` reports it. */
const priceChange = (from: string) =>
  ({ items: { data: [{ price: { id: from } }] }, plan: { id: from }, latest_invoice: 'in_old' }) as unknown as Partial<Stripe.Subscription>

describe('lowered_at_once', () => {
  it.each([
    ['managed → own key', 'price_ai_m', 'price_byok_m', 'proAi/managed/monthly', 'proAi/byok/monthly'],
    ['Pro AI → Pro', 'price_ai_y', 'price_pro_y', 'proAi/managed/yearly', 'pro/yearly'],
    ['Pro yearly → Pro AI monthly', 'price_pro_y', 'price_ai_m', 'pro/yearly', 'proAi/managed/monthly'],
    ['yearly → monthly on one plan', 'price_pro_y', 'price_pro_m', 'pro/yearly', 'pro/monthly'],
  ])('%s applied with no schedule attached raises it', (_l, from, to, fromLabel, toLabel) => {
    const update = { object: subscription(to), previous_attributes: priceChange(from) }
    expect(planChangeAlarms(update, null)).toEqual([
      { kind: 'lowered_at_once', subscriptionId: 'sub_1', from: fromLabel, to: toLabel },
    ])
  })

  it('stays quiet when the change lands through a schedule (the portal deferred it, or the server did)', () => {
    const update = {
      object: subscription('price_byok_m', { schedule: 'sub_sched_1' }),
      previous_attributes: priceChange('price_ai_m'),
    }
    expect(planChangeAlarms(update, null)).toEqual([])
  })

  it.each([
    ['Pro → Pro AI', 'price_pro_m', 'price_ai_m'],
    ['own key → managed', 'price_byok_m', 'price_ai_m'],
    ['monthly → yearly', 'price_pro_m', 'price_pro_y'],
  ])('stays quiet for an upgrade applied at once (%s)', (_l, from, to) => {
    expect(planChangeAlarms({ object: subscription(to), previous_attributes: priceChange(from) }, null)).toEqual([])
  })

  it('stays quiet when the price did not change (a renewal, a status change) or nothing was reported', () => {
    expect(planChangeAlarms({ object: subscription('price_pro_m'), previous_attributes: priceChange('price_pro_m') }, null)).toEqual([])
    expect(planChangeAlarms({ object: subscription('price_pro_m'), previous_attributes: { status: 'past_due' } as Partial<Stripe.Subscription> }, null)).toEqual([])
    expect(planChangeAlarms({ object: subscription('price_pro_m') }, null)).toEqual([])
  })

  it('reads the legacy top-level plan when items are not in previous_attributes', () => {
    const previous = { plan: { id: 'price_ai_m' } } as unknown as Partial<Stripe.Subscription>
    expect(planChangeAlarms({ object: subscription('price_pro_m'), previous_attributes: previous }, null)).toHaveLength(1)
  })

  it('stays quiet for a price this deployment does not sell, rather than raise a false alarm', () => {
    expect(planChangeAlarms({ object: subscription('price_legacy'), previous_attributes: priceChange('price_ai_m') }, null)).toEqual([])
    expect(planChangeAlarms({ object: subscription('price_pro_m'), previous_attributes: priceChange('price_legacy') }, null)).toEqual([])
  })
})

describe('credit', () => {
  // An upgrade, so only the invoice can raise an alarm.
  const upgrade = (current: Stripe.Subscription | null, previous = priceChange('price_pro_m')) =>
    planChangeAlarms({ object: subscription('price_ai_m'), previous_attributes: previous }, current)

  it('a plan-change invoice with a negative total raises it (the -$35.00 seen in test mode)', () => {
    const current = subscription('price_ai_m', {
      latest_invoice: invoice({ total: -3500, starting_balance: 0, ending_balance: -3500 }),
    })
    expect(upgrade(current)).toEqual([
      { kind: 'credit', subscriptionId: 'sub_1', invoiceId: 'in_new', total: -3500, balanceChange: -3500 },
    ])
  })

  it('a plan-change invoice that moved the balance further into credit raises it, whatever its total', () => {
    const current = subscription('price_ai_m', {
      latest_invoice: invoice({ total: 0, starting_balance: -100, ending_balance: -300 }),
    })
    expect(upgrade(current)).toEqual([
      { kind: 'credit', subscriptionId: 'sub_1', invoiceId: 'in_new', total: 0, balanceChange: -200 },
    ])
  })

  it('an upgrade charged as usual stays quiet, including one paid from an existing credit', () => {
    expect(upgrade(subscription('price_ai_m', { latest_invoice: invoice({ total: 400 }) }))).toEqual([])
    expect(
      upgrade(subscription('price_ai_m', { latest_invoice: invoice({ total: 200, starting_balance: -200, ending_balance: 0 }) }))
    ).toEqual([])
  })

  it('a draft invoice (no ending balance yet) is judged on its total', () => {
    const current = subscription('price_ai_m', { latest_invoice: invoice({ total: -100, ending_balance: null }) })
    expect(upgrade(current)).toEqual([
      { kind: 'credit', subscriptionId: 'sub_1', invoiceId: 'in_new', total: -100, balanceChange: null },
    ])
  })

  it('only judges an invoice this update set, of a plan change', () => {
    const negative = { latest_invoice: invoice({ total: -3500, ending_balance: -3500 }) }
    // The update didn't set latest_invoice: a later event for the same subscription.
    const noInvoiceChange = { items: { data: [{ price: { id: 'price_pro_m' } }] } } as unknown as Partial<Stripe.Subscription>
    expect(upgrade(subscription('price_ai_m', negative), noInvoiceChange)).toEqual([])
    // The subscription has moved on to another invoice since the event.
    expect(upgrade(subscription('price_ai_m', { latest_invoice: invoice({ id: 'in_later', total: -3500 }) }))).toEqual([])
    // A renewal or a first invoice is not a plan change.
    expect(upgrade(subscription('price_ai_m', { latest_invoice: invoice({ total: -3500, billing_reason: 'subscription_cycle' }) }))).toEqual([])
    // Not expanded, or not read at all.
    expect(upgrade(subscription('price_ai_m', { latest_invoice: 'in_new' }))).toEqual([])
    expect(upgrade(null)).toEqual([])
  })

  it('a downgrade applied at once with a credit raises both alarms', () => {
    const current = subscription('price_ai_m', { latest_invoice: invoice({ total: -3500, ending_balance: -3500 }) })
    const alarms = planChangeAlarms({ object: subscription('price_ai_m'), previous_attributes: priceChange('price_pro_y') }, current)
    expect(alarms.map((a) => a.kind)).toEqual(['lowered_at_once', 'credit'])
  })
})

describe('logPlanChangeAlarm', () => {
  it('writes one searchable error line with ids, plans and amounts only', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    logPlanChangeAlarm('customer.subscription.updated', {
      kind: 'lowered_at_once',
      subscriptionId: 'sub_1',
      from: 'proAi/managed/monthly',
      to: 'proAi/byok/monthly',
    })
    logPlanChangeAlarm('customer.subscription.updated', {
      kind: 'credit',
      subscriptionId: 'sub_1',
      invoiceId: 'in_new',
      total: -3500,
      balanceChange: null,
    })
    expect(error).toHaveBeenCalledTimes(2)
    const [first, second] = error.mock.calls.map((call) => {
      expect(call).toHaveLength(1)
      return String(call[0])
    })
    expect(first).toMatch(/^Stripe webhook: PLAN_CHANGE_ALARM lowered_at_once on customer\.subscription\.updated \(subscription sub_1, proAi\/managed\/monthly -> proAi\/byok\/monthly applied with no schedule\)/)
    expect(second).toMatch(/^Stripe webhook: PLAN_CHANGE_ALARM credit on customer\.subscription\.updated \(subscription sub_1, invoice in_new total -3500, balance change unknown\)/)
  })

  it('sends the same text to Sentry as an error, grouped by signal (stable fingerprint)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCaptureMessage.mockClear()
    logPlanChangeAlarm('customer.subscription.updated', {
      kind: 'lowered_at_once',
      subscriptionId: 'sub_1',
      from: 'pro/yearly',
      to: 'pro/monthly',
    })
    logPlanChangeAlarm('customer.subscription.updated', {
      kind: 'credit',
      subscriptionId: 'sub_2',
      invoiceId: 'in_2',
      total: -100,
      balanceChange: -100,
    })
    expect(mockCaptureMessage).toHaveBeenCalledTimes(2)
    expect(mockCaptureMessage.mock.calls[0]).toEqual([
      error.mock.calls[0][0],
      { level: 'error', fingerprint: ['plan-change-alarm', 'lowered_at_once'], tags: { plan_change_alarm: 'lowered_at_once' } },
    ])
    expect(mockCaptureMessage.mock.calls[1]).toEqual([
      error.mock.calls[1][0],
      { level: 'error', fingerprint: ['plan-change-alarm', 'credit'], tags: { plan_change_alarm: 'credit' } },
    ])
  })

  it('flushPlanChangeAlarms waits at most 2 seconds for Sentry', async () => {
    await flushPlanChangeAlarms()
    expect(mockFlush).toHaveBeenCalledWith(2000)
  })
})
