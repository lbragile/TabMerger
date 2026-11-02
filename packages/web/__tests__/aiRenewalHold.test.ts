/**
 * A renewal's AI credits open when it is paid, not when Stripe moves the period (about an hour before
 * it charges): findUnpaidRenewal() and aiWriteColumns() in lib/aiAllowance.ts, the
 * `invoice.paid` handler, and the plain subscription writes that use the same rule. What the database
 * does with the writes (keep_ai_period, carry_ai_packs_forward, the freeze) is covered by
 * supabase/tests/030_ai_billing_period_credits.test.sql.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PRO_AI_MONTHLY_CREDITS } from '@tabmerger/shared'
import { findUnpaidRenewal } from '@/lib/aiAllowance'
import type Stripe from 'stripe'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))

const mockConstructEvent = vi.fn()
const mockSubscriptionsRetrieve = vi.fn()
const mockInvoicesList = vi.fn()

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionsRetrieve },
    invoices: { list: mockInvoicesList },
    coupons: { retrieve: vi.fn() },
    checkout: { sessions: { listLineItems: vi.fn() } },
  },
}))

const USER = '11111111-1111-4111-8111-111111111111'
const mockUpsert = vi.fn()
const updates: Array<{ values: Record<string, unknown>; id: string }> = []
/** Which subscription ids have a row. */
let rowIds = new Set<string>(['sub_1'])
let updateError: { code: string; message: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => ({ data: rowIds.has(id) ? { user_id: USER } : null, error: null }),
        }),
      }),
      upsert: mockUpsert,
      update: (values: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({
          select: async () => {
            if (updateError) return { data: null, error: updateError }
            if (!rowIds.has(id)) return { data: [], error: null }
            updates.push({ values, id })
            return { data: [{ id }], error: null }
          },
        }),
      }),
    }),
  })),
}))

const OLD_START = 1_793_000_000
const NEW_START = 1_795_600_000
const NEW_END = 1_798_200_000
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

type InvoiceFields = Record<string, unknown> | null

/** Stripe's subscription right after it moved the period (NEW_START to NEW_END). */
function subscription(status: string, invoice: InvoiceFields, extra: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status,
    cancel_at_period_end: false,
    metadata: { user_id: USER },
    discounts: [],
    latest_invoice: invoice,
    items: {
      data: [{ price: { id: 'price_ai_m' }, current_period_start: NEW_START, current_period_end: NEW_END, discounts: [] }],
    },
    ...extra,
  }
}

const cycleInvoice = (status: string, fields: Record<string, unknown> = {}) => ({
  id: 'in_cycle',
  billing_reason: 'subscription_cycle',
  status,
  amount_due: 799,
  subtotal: 799,
  total_discount_amounts: [],
  period_start: OLD_START,
  period_end: NEW_START,
  ...fields,
})

async function post(type: string, object: Record<string, unknown>, current: unknown) {
  mockSubscriptionsRetrieve.mockResolvedValue(current)
  mockConstructEvent.mockReturnValue({ type, data: { object } })
  const { POST } = await import('@/app/api/webhooks/stripe/route')
  return POST(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }))
}

const paidEvent = (invoice: Record<string, unknown> = { parent: { subscription_details: { subscription: 'sub_1' } } }) => ({
  id: 'in_cycle',
  ...invoice,
})

/** Stripe's invoice list by status. A paid invoice ending at OLD_START covers the period just ended. */
function listing(lists: Partial<Record<string, unknown[]>> = {}) {
  const all: Record<string, unknown[]> = { paid: [{ id: 'in_prev', period_end: OLD_START }], draft: [], open: [], ...lists }
  mockInvoicesList.mockImplementation(async ({ status }: { status: string }) => ({ data: all[status] ?? [] }))
}

let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoicesList.mockReset()
  listing()
  updates.length = 0
  rowIds = new Set(['sub_1'])
  updateError = null
  mockUpsert.mockResolvedValue({ error: null })
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
  vi.stubEnv('STRIPE_PRO_MONTHLY_PRICE_ID', 'price_pro_m')
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('findUnpaidRenewal', () => {
  const invoices = { list: mockInvoicesList }
  const find = (status: string, invoice: InvoiceFields | string) =>
    findUnpaidRenewal(subscription(status, invoice as InvoiceFields) as unknown as Stripe.Subscription, invoices)
  const held = async (status: string, invoice: InvoiceFields | string) => (await find(status, invoice)) !== null

  it.each(['draft', 'open'])('holds on an active subscription with a %s renewal invoice', async (status) => {
    expect(await held('active', cycleInvoice(status))).toBe(true)
  })

  it.each(['void', 'uncollectible'])('holds on a %s renewal invoice: nothing was paid', async (status) => {
    expect(await held('active', cycleInvoice(status))).toBe(true)
  })

  it('holds through past_due while the renewal stays unpaid', async () => {
    expect(await held('past_due', cycleInvoice('open'))).toBe(true)
  })

  it('a paid renewal does not hold', async () => {
    expect(await held('active', cycleInvoice('paid'))).toBe(false)
    expect(await held('past_due', cycleInvoice('paid'))).toBe(false)
  })

  it('a renewal with nothing to pay does not hold, even as a draft (100% coupon, $0 price)', async () => {
    expect(await held('active', cycleInvoice('draft', { amount_due: 0 }))).toBe(false)
  })

  it('send_invoice holds until paid, like any renewal', async () => {
    const sub = subscription('active', cycleInvoice('open'), { collection_method: 'send_invoice' })
    expect(await findUnpaidRenewal(sub as unknown as Stripe.Subscription, invoices)).not.toBeNull()
  })

  it.each(['subscription_update', 'manual', 'subscription_threshold'])(
    'a %s invoice with no renewal behind it does not hold, paid or not',
    async (reason) => {
      expect(await held('active', cycleInvoice('open', { billing_reason: reason }))).toBe(false)
    }
  )

  it('a first invoice never holds and lists nothing: no renewal can be behind it', async () => {
    expect(await held('active', cycleInvoice('open', { billing_reason: 'subscription_create' }))).toBe(false)
    expect(mockInvoicesList).not.toHaveBeenCalled()
  })

  it('no expanded invoice does not hold and lists nothing', async () => {
    expect(await held('active', null)).toBe(false)
    expect(await held('active', 'in_123')).toBe(false)
    expect(mockInvoicesList).not.toHaveBeenCalled()
  })

  it.each(['incomplete', 'trialing', 'canceled', 'unpaid'])('status %s does not hold', async (status) => {
    expect(await held(status, cycleInvoice('open'))).toBe(false)
  })

  describe('a newer invoice hiding an unpaid renewal (measured on a test clock)', () => {
    const upgrade = (status: string) => cycleInvoice(status, { id: 'in_up', billing_reason: 'subscription_update', period_start: NEW_START + 30, period_end: NEW_START + 30 })

    it.each([
      ['open renewal, paid upgrade: past_due becomes active', 'active', 'paid', { open: [cycleInvoice('open')] }],
      ['draft renewal, paid upgrade in the draft hour', 'active', 'paid', { draft: [cycleInvoice('draft')] }],
      ['draft renewal, failed upgrade left as a pending update', 'active', 'open', { draft: [cycleInvoice('draft')], open: [upgrade('open')] }],
      ['draft renewal, failed upgrade with allow_incomplete: past_due', 'past_due', 'open', { draft: [cycleInvoice('draft')], open: [upgrade('open')] }],
      ['renewal charge failed after a paid upgrade: still active', 'active', 'paid', { open: [cycleInvoice('open')] }],
    ])('%s: holds', async (_label, status, upgradeStatus, lists) => {
      listing(lists)
      const found = await find(status as string, upgrade(upgradeStatus as string))
      expect(found?.invoice?.billing_reason).toBe('subscription_cycle')
    })

    it('an open renewal for an earlier period start does not hold', async () => {
      listing({ open: [cycleInvoice('open', { period_end: OLD_START })] })
      expect(await held('active', upgrade('paid'))).toBe(false)
    })

    it('a listed renewal with nothing to pay does not hold', async () => {
      listing({ draft: [cycleInvoice('draft', { amount_due: 0 })] })
      expect(await held('active', upgrade('paid'))).toBe(false)
    })

    it.each(['void', 'uncollectible'])('a hidden %s renewal for this period start stays held, with no catch-up', async (status) => {
      listing({ [status]: [cycleInvoice(status)] })
      const found = await find('active', upgrade('paid'))
      expect(found?.invoice?.status).toBe(status)
      expect(found?.priorPeriodPaid).toBe(false)
    })

    it('a written-off renewal does not keep back a customer who paid a later one: its period no longer matches', async () => {
      listing({ void: [cycleInvoice('void', { period_end: OLD_START })] })
      expect(await held('active', upgrade('paid'))).toBe(false)
    })

    it('a paid later renewal as the latest invoice ends the hold without listing', async () => {
      listing({ void: [cycleInvoice('void', { period_end: OLD_START })] })
      expect(await held('active', cycleInvoice('paid'))).toBe(false)
      expect(mockInvoicesList).not.toHaveBeenCalled()
    })

    it('asks for the largest page, and a list with more pages and no match holds', async () => {
      mockInvoicesList.mockImplementation(async ({ status }: { status: string }) => ({ data: [], has_more: status === 'open' }))
      const found = await find('active', upgrade('paid'))
      expect(found).toEqual({ invoice: null, priorPeriodPaid: false })
      expect(mockInvoicesList.mock.calls.every(([params]) => params.limit === 100)).toBe(true)
    })

    it('a match on a page with more behind it needs no more reads', async () => {
      mockInvoicesList.mockImplementation(async ({ status }: { status: string }) =>
        status === 'draft' ? { data: [cycleInvoice('draft')], has_more: true } : { data: [{ id: 'in_prev', period_end: OLD_START }] }
      )
      const found = await find('active', upgrade('paid'))
      expect(found?.invoice?.status).toBe('draft')
    })

    it('a failed read fails: it never reads as no hold', async () => {
      mockInvoicesList.mockRejectedValue(new Error('stripe down'))
      await expect(find('active', upgrade('paid'))).rejects.toThrow('stripe down')
    })
  })

  describe('whether the period it follows was paid for', () => {
    it('yes, when a paid invoice ends where that period starts', async () => {
      expect((await find('active', cycleInvoice('draft')))?.priorPeriodPaid).toBe(true)
    })

    it('no, when none does', async () => {
      listing({ paid: [{ id: 'in_older', period_end: OLD_START - 2_592_000 }] })
      expect((await find('active', cycleInvoice('draft')))?.priorPeriodPaid).toBe(false)
    })

    it.each(['void', 'uncollectible'])('a %s renewal answers no without reading', async (status) => {
      expect((await find('active', cycleInvoice(status)))?.priorPeriodPaid).toBe(false)
      expect(mockInvoicesList).not.toHaveBeenCalled()
    })

    it('a failed read fails', async () => {
      mockInvoicesList.mockRejectedValue(new Error('stripe down'))
      await expect(find('active', cycleInvoice('draft'))).rejects.toThrow('stripe down')
    })
  })
})

describe('a subscription write while a renewal awaits payment', () => {
  it('customer.subscription.updated keeps the old period and the allowance out of the write', async () => {
    const current = subscription('active', cycleInvoice('draft'))
    expect((await post('customer.subscription.updated', current, current)).status).toBe(200)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(OLD_START))
    expect(row.ai_period_end).toBe(iso(NEW_START))
    expect(row).not.toHaveProperty('ai_monthly_credits')
    expect(row.status).toBe('active')
    expect(row.current_period_end).toBe(iso(NEW_END))
  })

  it('writes no period at all when the invoice does not line up with the item period', async () => {
    const current = subscription('active', cycleInvoice('draft', { period_end: NEW_START - 5 }))
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row).not.toHaveProperty('ai_period_start')
    expect(row).not.toHaveProperty('ai_period_end')
  })

  it.each(['void', 'uncollectible'])('a %s renewal writes no period: it must not catch up to one nobody paid for', async (status) => {
    const current = subscription('active', cycleInvoice(status))
    await post('customer.subscription.updated', current, current)
    const row = mockUpsert.mock.calls[0][0]
    expect(row).not.toHaveProperty('ai_period_start')
    expect(row).not.toHaveProperty('ai_period_end')
    expect(row).not.toHaveProperty('ai_monthly_credits')
  })

  it('two voided cycles in a row (pause_collection): the stored period never moves', async () => {
    const SECOND = NEW_END
    for (const [start, end] of [
      [NEW_START, NEW_END],
      [SECOND, SECOND + 2_592_000],
    ]) {
      mockUpsert.mockClear()
      const current = subscription('active', cycleInvoice('void', { period_start: start - 2_600_000, period_end: start }), {
        items: { data: [{ price: { id: 'price_ai_m' }, current_period_start: start, current_period_end: end, discounts: [] }] },
      })
      await post('customer.subscription.updated', current, current)
      expect(mockUpsert.mock.calls[0][0]).not.toHaveProperty('ai_period_start')
    }
  })

  it('a draft after a voided cycle: the period it follows was never paid, so no catch-up', async () => {
    listing({ paid: [] })
    const current = subscription('active', cycleInvoice('draft'))
    await post('customer.subscription.updated', current, current)
    expect(mockUpsert.mock.calls[0][0]).not.toHaveProperty('ai_period_start')
  })

  it('a row left behind catches up to a period that was paid, not to the new one', async () => {
    const current = subscription('active', cycleInvoice('draft'))
    await post('customer.subscription.updated', current, current)
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({ ai_period_start: iso(OLD_START), ai_period_end: iso(NEW_START) })
  })

  it('a list too long to tell: no period and no allowance are written', async () => {
    mockInvoicesList.mockImplementation(async () => ({ data: [], has_more: true }))
    const current = subscription('active', cycleInvoice('paid', { id: 'in_up', billing_reason: 'subscription_update' }))
    await post('customer.subscription.updated', current, current)
    const row = mockUpsert.mock.calls[0][0]
    expect(row).not.toHaveProperty('ai_period_start')
    expect(row).not.toHaveProperty('ai_monthly_credits')
  })

  it('a paid upgrade hiding an open renewal: the period and allowance stay held', async () => {
    listing({ open: [cycleInvoice('open')] })
    const current = subscription('active', cycleInvoice('paid', { id: 'in_up', billing_reason: 'subscription_update', period_start: NEW_START + 30, period_end: NEW_START + 30 }))
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(OLD_START))
    expect(row).not.toHaveProperty('ai_monthly_credits')
  })

  it('answers 500 when the invoices cannot be read, so Stripe delivers it again and nothing is written', async () => {
    mockInvoicesList.mockRejectedValue(Object.assign(new Error('down'), { type: 'StripeAPIError', statusCode: 503 }))
    const current = subscription('active', cycleInvoice('paid', { id: 'in_up', billing_reason: 'subscription_update' }))
    const res = await post('customer.subscription.updated', current, current)
    expect(res.status).toBe(500)
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('invoice list retrieve failed (subscription sub_1, StripeAPIError, status 503)')
  })

  it('past_due: the period stays and the allowance is written as 0, which is what freezes it', async () => {
    const current = subscription('past_due', cycleInvoice('open'))
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(OLD_START))
    expect(row.ai_monthly_credits).toBe(0)
  })

  it('a later update that finds the invoice paid advances: a missed invoice.paid heals on the next write', async () => {
    const current = subscription('active', cycleInvoice('paid'))
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(NEW_START))
    expect(row.ai_period_end).toBe(iso(NEW_END))
    expect(row.ai_monthly_credits).toBe(PRO_AI_MONTHLY_CREDITS)
  })

  it('never holds a first invoice, whatever its state', async () => {
    const first = cycleInvoice('open', { billing_reason: 'subscription_create', period_start: NEW_START, period_end: NEW_START })
    const current = subscription('active', first)
    await post('customer.subscription.updated', current, current)
    expect(mockUpsert.mock.calls[0][0].ai_period_start).toBe(iso(NEW_START))
  })

  it('a mid-period upgrade (subscription_update) never holds, and an unpaid proration still gives share 0', async () => {
    const line = {
      amount: 400,
      discount_amounts: [],
      parent: { subscription_item_details: { proration: true } },
      pricing: { price_details: { price: 'price_ai_m' } },
      period: { start: NEW_START + 1_300_000, end: NEW_END },
    }
    const invoice = cycleInvoice('open', { billing_reason: 'subscription_update', lines: { data: [line] }, period_start: NEW_START + 1_300_000, period_end: NEW_START + 1_300_000 })
    const current = subscription('active', invoice)
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(NEW_START))
    expect(row.ai_monthly_credits).toBe(0)
  })

  it('a paid mid-period upgrade keeps its proportional allowance and the period', async () => {
    const line = {
      amount: 400,
      discount_amounts: [],
      parent: { subscription_item_details: { proration: true } },
      pricing: { price_details: { price: 'price_ai_m' } },
      period: { start: NEW_START + 1_300_000, end: NEW_END },
    }
    const invoice = cycleInvoice('paid', { billing_reason: 'subscription_update', lines: { data: [line] } })
    const current = subscription('active', invoice)
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(NEW_START))
    expect(row.ai_monthly_credits).toBeGreaterThan(0)
    expect(row.ai_monthly_credits).toBeLessThan(PRO_AI_MONTHLY_CREDITS)
  })

  it('a yearly plan between renewals: its paid year-start invoice does not hold', async () => {
    const yearStart = NEW_START
    const yearEnd = yearStart + 31_536_000
    const current = subscription('active', cycleInvoice('paid', { period_start: yearStart - 31_536_000, period_end: yearStart }), {
      items: { data: [{ price: { id: 'price_ai_y' }, current_period_start: yearStart, current_period_end: yearEnd, discounts: [] }] },
    })
    await post('customer.subscription.updated', current, current)

    const row = mockUpsert.mock.calls[0][0]
    expect(row.ai_period_start).toBe(iso(yearStart))
    expect(row.ai_period_end).toBe(iso(yearEnd))
  })
})

describe('invoice.paid', () => {
  it('writes the new period and allowance to the row under the subscription id', async () => {
    const res = await post('invoice.paid', paidEvent(), subscription('active', cycleInvoice('paid')))
    expect(res.status).toBe(200)

    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('sub_1')
    expect(updates[0].values).toMatchObject({
      status: 'active',
      tier: 'pro_ai',
      ai_period_start: iso(NEW_START),
      ai_period_end: iso(NEW_END),
      ai_monthly_credits: PRO_AI_MONTHLY_CREDITS,
    })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('reads the older top-level invoice.subscription shape too', async () => {
    await post('invoice.paid', paidEvent({ subscription: 'sub_1' }), subscription('active', cycleInvoice('paid')))
    expect(updates).toHaveLength(1)
  })

  it('is idempotent: a redelivery writes the same values', async () => {
    const current = subscription('active', cycleInvoice('paid'))
    await post('invoice.paid', paidEvent(), current)
    await post('invoice.paid', paidEvent(), current)
    const { updated_at: _a, ...first } = updates[0].values
    const { updated_at: _b, ...second } = updates[1].values
    expect(second).toEqual(first)
  })

  it('a retry that pays a failed renewal: past_due becomes active, the period advances, the allowance returns', async () => {
    await post('invoice.paid', paidEvent(), subscription('active', cycleInvoice('paid')))
    expect(updates[0].values).toMatchObject({ status: 'active', ai_period_start: iso(NEW_START), ai_monthly_credits: PRO_AI_MONTHLY_CREDITS })
  })

  it("an older invoice's event while a newer renewal is unpaid answers 200 and doesn't advance", async () => {
    // The event names the invoice just paid; Stripe's latest is the next renewal, still a draft.
    const res = await post('invoice.paid', paidEvent({ id: 'in_older', subscription: 'sub_1' }), subscription('active', cycleInvoice('draft')))
    expect(res.status).toBe(200)
    expect(updates[0].values).toMatchObject({ ai_period_start: iso(OLD_START), ai_period_end: iso(NEW_START) })
    expect(updates[0].values).not.toHaveProperty('ai_monthly_credits')
  })

  it("this invoice is the latest and Stripe doesn't read it as paid yet: 500, so Stripe delivers it again", async () => {
    const res = await post('invoice.paid', paidEvent(), subscription('active', cycleInvoice('open')))
    expect(res.status).toBe(500)
    expect(updates).toEqual([])
    expect(errorSpy.mock.calls.flat().join(' ')).toContain("the invoice doesn't read as paid yet (subscription sub_1, invoice status open)")
  })

  it("a newer invoice is the latest but Stripe's list still has this renewal as unpaid: 500, and it ends once the list catches up", async () => {
    const upgrade = cycleInvoice('paid', { id: 'in_up', billing_reason: 'subscription_update', period_start: NEW_START + 30, period_end: NEW_START + 30 })
    listing({ open: [cycleInvoice('open')] })
    const stale = await post('invoice.paid', paidEvent(), subscription('active', upgrade))
    expect(stale.status).toBe(500)
    expect(errorSpy.mock.calls.flat().join(' ')).toContain('the renewal still lists as unpaid (subscription sub_1)')

    listing()
    const caughtUp = await post('invoice.paid', paidEvent(), subscription('active', upgrade))
    expect(caughtUp.status).toBe(200)
    expect(updates.at(-1)?.values).toMatchObject({ ai_period_start: iso(NEW_START), ai_monthly_credits: PRO_AI_MONTHLY_CREDITS })
  })

  it("another invoice's event with a different renewal unpaid answers 200", async () => {
    const upgrade = cycleInvoice('paid', { id: 'in_up', billing_reason: 'subscription_update' })
    listing({ open: [cycleInvoice('open')] })
    const res = await post('invoice.paid', paidEvent({ id: 'in_up', subscription: 'sub_1' }), subscription('active', upgrade))
    expect(res.status).toBe(200)
  })

  it('an invoice with no subscription changes nothing', async () => {
    const res = await post('invoice.paid', { id: 'in_oneoff', parent: null }, subscription('active', cycleInvoice('paid')))
    expect(res.status).toBe(200)
    expect(mockSubscriptionsRetrieve).not.toHaveBeenCalled()
    expect(updates).toEqual([])
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('a subscription no row tracks changes nothing: no insert, no takeover', async () => {
    rowIds = new Set()
    const res = await post('invoice.paid', paidEvent(), subscription('active', cycleInvoice('paid')))
    expect(res.status).toBe(200)
    expect(updates).toEqual([])
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(warnSpy.mock.calls.flat().join(' ')).toContain('invoice.paid matched no subscription row or user (subscription sub_1)')
  })

  it('a subscription Stripe no longer has changes nothing', async () => {
    mockConstructEvent.mockReturnValue({ type: 'invoice.paid', data: { object: paidEvent() } })
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }))
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }))
    expect(res.status).toBe(200)
    expect(updates).toEqual([])
  })

  it('a canceled subscription is written as ended, like every other write', async () => {
    await post('invoice.paid', paidEvent(), subscription('canceled', cycleInvoice('paid')))
    expect(updates[0].values).toMatchObject({ status: 'canceled', tier: 'free', ai_monthly_credits: 0 })
  })

  it('answers 500 when the write fails, and when Stripe cannot be read, so Stripe delivers it again', async () => {
    updateError = { code: '08006', message: 'connection failure' }
    expect((await post('invoice.paid', paidEvent(), subscription('active', cycleInvoice('paid')))).status).toBe(500)

    updateError = null
    mockSubscriptionsRetrieve.mockReset()
    mockConstructEvent.mockReturnValue({ type: 'invoice.paid', data: { object: paidEvent() } })
    mockSubscriptionsRetrieve.mockRejectedValue(Object.assign(new Error('down'), { type: 'StripeAPIError', statusCode: 503 }))
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' }))
    expect(res.status).toBe(500)
  })
})
