/**
 * Tests for lib/aiAllowanceResync.ts, the one-off re-sync of `ai_mode` / `ai_monthly_credits` / the
 * AI period for existing pro_ai rows (run by scripts/resync-ai-allowance.ts after migrations 022 and 030). Stripe and
 * Supabase are fakes: nothing here talks to a real project.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PRO_AI_MONTHLY_CREDITS, creditsForPayment } from '@tabmerger/shared'
import { resyncAiAllowances } from '@/lib/aiAllowanceResync'

type Row = {
  id: string
  ai_mode: string | null
  ai_monthly_credits: number | null
  ai_period_start?: string | null
  ai_period_end?: string | null
}

function fakeSupabase(rows: Row[], { readError = null as unknown, updateError = null as unknown } = {}) {
  const updates: Array<{ id: string; values: unknown }> = []
  const filters: Array<[string, unknown]> = []
  const supabase = {
    from: vi.fn(() => {
      const q = {
        select: vi.fn(() => q),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push([column, value])
          return q
        }),
        order: vi.fn(() => q),
        range: vi.fn(async (from: number, to: number) =>
          readError ? { data: null, error: readError } : { data: rows.slice(from, to + 1), error: null }
        ),
        update: vi.fn((values: unknown) => ({
          eq: vi.fn(async (_c: string, id: string) => {
            if (!updateError) updates.push({ id, values })
            return { error: updateError }
          }),
        })),
      }
      return q
    }),
  }
  return { supabase, updates, filters }
}

const sub = (id: string, price: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'active',
  customer: 'cus_1',
  discounts: [],
  latest_invoice: null,
  items: { data: [{ price: { id: price }, discounts: [] }] },
  ...extra,
})

function fakeStripe(subscriptions: Record<string, unknown>) {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        const found = subscriptions[id]
        if (found instanceof Error) throw found
        if (!found) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' })
        return found
      }),
    },
    coupons: { retrieve: vi.fn(async () => ({ id: 'co_1', percent_off: 50 })) },
    invoices: { list: vi.fn(async ({ status }: { status: string }) => ({ data: status === 'paid' ? [{ period_end: 1_793_000_000 }] : [] })) },
  }
}

beforeEach(() => {
  vi.stubEnv('STRIPE_PRO_AI_MONTHLY_PRICE_ID', 'price_ai_m')
  vi.stubEnv('STRIPE_PRO_AI_YEARLY_PRICE_ID', 'price_ai_y')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_MONTHLY_PRICE_ID', 'price_byok_m')
  vi.stubEnv('STRIPE_PRO_AI_BYOK_YEARLY_PRICE_ID', 'price_byok_y')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resyncAiAllowances', () => {
  const rows: Row[] = [
    { id: 'sub_managed', ai_mode: 'managed', ai_monthly_credits: 0 },
    { id: 'sub_byok', ai_mode: 'managed', ai_monthly_credits: 0 },
    { id: 'sub_ok', ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS },
    { id: 'sub_half', ai_mode: 'managed', ai_monthly_credits: 0 },
    { id: 'free_user', ai_mode: 'managed', ai_monthly_credits: 0 },
    { id: 'sub_gone', ai_mode: 'managed', ai_monthly_credits: 0 },
    { id: 'sub_error', ai_mode: 'managed', ai_monthly_credits: 0 },
  ]
  const stripeState = {
    sub_managed: sub('sub_managed', 'price_ai_y'),
    sub_byok: sub('sub_byok', 'price_byok_m'),
    sub_ok: sub('sub_ok', 'price_ai_m'),
    sub_half: sub('sub_half', 'price_ai_m', {
      discounts: [{ id: 'di_1', source: { type: 'coupon', coupon: 'co_1' } }],
    }),
    sub_error: Object.assign(new Error('boom'), { type: 'StripeAPIError' }),
  }

  it('dry run: reports what would change and writes nothing', async () => {
    const { supabase, updates, filters } = fakeSupabase(rows)
    const stripe = fakeStripe(stripeState)
    const lines: string[] = []

    const result = await resyncAiAllowances({ stripe: stripe as never, supabase: supabase as never, apply: false, log: (l) => lines.push(l) })

    expect(filters).toContainEqual(['tier', 'pro_ai'])
    expect(result).toEqual({
      scanned: 7,
      unchanged: 1,
      changed: ['sub_managed', 'sub_byok', 'sub_half'],
      heldOnUnpaid: [],
      behindPaidRenewal: [],
      skipped: ['free_user', 'sub_gone'],
      failed: ['sub_error'],
    })
    expect(updates).toEqual([])
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_managed', {
      expand: ['discounts', 'items.data.discounts', 'latest_invoice', 'customer'],
    })
    // Only Stripe subscription ids and numbers are printed.
    expect(lines.join('\n')).not.toMatch(/@|cus_/)
  })

  describe('the AI period (migration 030)', () => {
    const START = 1_793_000_000
    const END = 1_795_600_000
    const withPeriod = sub('sub_p', 'price_ai_m', {
      items: { data: [{ price: { id: 'price_ai_m' }, discounts: [], current_period_start: START, current_period_end: END }] },
    })
    const base = { id: 'sub_p', ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS }
    const iso = (s: number) => new Date(s * 1000).toISOString()

    it('dry run: an otherwise matching row with no stored period is reported, nothing is written', async () => {
      const { supabase, updates } = fakeSupabase([base])
      const result = await resyncAiAllowances({ stripe: fakeStripe({ sub_p: withPeriod }) as never, supabase: supabase as never, apply: false })
      expect(result.changed).toEqual(['sub_p'])
      expect(updates).toEqual([])
    })

    it('--apply backfills the period', async () => {
      const { supabase, updates } = fakeSupabase([base])
      await resyncAiAllowances({ stripe: fakeStripe({ sub_p: withPeriod }) as never, supabase: supabase as never, apply: true })
      expect(updates).toEqual([
        {
          id: 'sub_p',
          values: { ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS, ai_period_start: iso(START), ai_period_end: iso(END) },
        },
      ])
    })

    it('a row already holding the period, in the database\'s +00:00 form, is unchanged', async () => {
      const stored = {
        ...base,
        ai_period_start: iso(START).replace('.000Z', '+00:00'),
        ai_period_end: iso(END).replace('.000Z', '+00:00'),
      }
      const { supabase, updates } = fakeSupabase([stored])
      const result = await resyncAiAllowances({ stripe: fakeStripe({ sub_p: withPeriod }) as never, supabase: supabase as never, apply: true })
      expect(result).toMatchObject({ unchanged: 1, changed: [] })
      expect(updates).toEqual([])
    })

    describe('a renewal and its invoice', () => {
      const NEXT = END + 2_592_000
      const renewed = (status: string, invoice: Record<string, unknown>) =>
        sub('sub_p', 'price_ai_m', {
          status,
          latest_invoice: { billing_reason: 'subscription_cycle', amount_due: 799, subtotal: 799, period_start: START, period_end: END, ...invoice },
          items: { data: [{ price: { id: 'price_ai_m' }, discounts: [], current_period_start: END, current_period_end: NEXT }] },
        })
      const stored = { ...base, ai_period_start: iso(START), ai_period_end: iso(END) }

      it('a renewal not paid yet: no new period is stored, the row is reported as held', async () => {
        const stripe = fakeStripe({ sub_p: renewed('active', { status: 'draft' }) })
        stripe.invoices.list = vi.fn(async () => ({ data: [{ period_end: START }] })) as never
        const { supabase, updates } = fakeSupabase([stored])
        const result = await resyncAiAllowances({ stripe: stripe as never, supabase: supabase as never, apply: true })
        expect(result).toMatchObject({ unchanged: 1, heldOnUnpaid: ['sub_p'], behindPaidRenewal: [], changed: [] })
        expect(updates).toEqual([])
      })

      it('held with a different allowance on the row: the allowance waits for the payment too', async () => {
        const { supabase, updates } = fakeSupabase([{ ...stored, ai_monthly_credits: 100 }])
        await resyncAiAllowances({ stripe: fakeStripe({ sub_p: renewed('active', { status: 'open' }) }) as never, supabase: supabase as never, apply: true })
        expect(updates).toEqual([])
      })

      it('a paid upgrade hiding an open renewal: held, and reported', async () => {
        const stripe = fakeStripe({
          sub_p: renewed('active', { status: 'paid', billing_reason: 'subscription_update', period_start: END + 30, period_end: END + 30 }),
        })
        stripe.invoices.list = vi.fn(async ({ status }: { status: string }) => ({
          data: status === 'open' ? [{ billing_reason: 'subscription_cycle', status: 'open', amount_due: 799, period_start: START, period_end: END }] : [{ period_end: START }],
        })) as never
        const { supabase, updates } = fakeSupabase([stored])
        const result = await resyncAiAllowances({ stripe: stripe as never, supabase: supabase as never, apply: true })
        expect(result).toMatchObject({ heldOnUnpaid: ['sub_p'], behindPaidRenewal: [], unchanged: 1 })
        expect(updates).toEqual([])
      })

      it('a failed invoice read is a failure for that row only: nothing is written', async () => {
        const stripe = fakeStripe({ sub_p: renewed('active', { status: 'draft' }) })
        stripe.invoices.list = vi.fn(async () => {
          throw Object.assign(new Error('down'), { type: 'StripeAPIError' })
        }) as never
        const { supabase, updates } = fakeSupabase([stored])
        const result = await resyncAiAllowances({ stripe: stripe as never, supabase: supabase as never, apply: true })
        expect(result.failed).toEqual(['sub_p'])
        expect(updates).toEqual([])
      })

      it('a row behind a paid renewal (a missed invoice.paid) advances and is listed', async () => {
        const { supabase, updates } = fakeSupabase([stored])
        const result = await resyncAiAllowances({ stripe: fakeStripe({ sub_p: renewed('active', { status: 'paid' }) }) as never, supabase: supabase as never, apply: true })
        expect(result).toMatchObject({ changed: ['sub_p'], behindPaidRenewal: ['sub_p'], heldOnUnpaid: [] })
        expect(updates[0].values).toMatchObject({ ai_period_start: iso(END), ai_period_end: iso(NEXT) })
      })

      it('dry run lists a row behind a paid renewal and writes nothing', async () => {
        const { supabase, updates } = fakeSupabase([stored])
        const result = await resyncAiAllowances({ stripe: fakeStripe({ sub_p: renewed('active', { status: 'paid' }) }) as never, supabase: supabase as never, apply: false })
        expect(result.behindPaidRenewal).toEqual(['sub_p'])
        expect(updates).toEqual([])
      })

      it('a first backfill during a hold stores the period just ended', async () => {
        const stripe = fakeStripe({ sub_p: renewed('active', { status: 'draft' }) })
        stripe.invoices.list = vi.fn(async () => ({ data: [{ period_end: START }] })) as never
        const { supabase, updates } = fakeSupabase([base])
        await resyncAiAllowances({ stripe: stripe as never, supabase: supabase as never, apply: true })
        expect(updates).toEqual([{ id: 'sub_p', values: { ai_mode: 'managed', ai_period_start: iso(START), ai_period_end: iso(END) } }])
      })
    })

    it('a stored period that differs is written', async () => {
      const stored = { ...base, ai_period_start: iso(START - 2_592_000), ai_period_end: iso(START) }
      const { supabase, updates } = fakeSupabase([stored])
      await resyncAiAllowances({ stripe: fakeStripe({ sub_p: withPeriod }) as never, supabase: supabase as never, apply: true })
      expect(updates[0].values).toMatchObject({ ai_period_start: iso(START), ai_period_end: iso(END) })
    })
  })

  it('--apply writes the same values the webhook would, to those rows only', async () => {
    const { supabase, updates } = fakeSupabase(rows)

    const result = await resyncAiAllowances({ stripe: fakeStripe(stripeState) as never, supabase: supabase as never, apply: true })

    expect(result.changed).toEqual(['sub_managed', 'sub_byok', 'sub_half'])
    expect(updates).toEqual([
      { id: 'sub_managed', values: { ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS, ai_period_start: null, ai_period_end: null } },
      { id: 'sub_byok', values: { ai_mode: 'byok', ai_monthly_credits: 0, ai_period_start: null, ai_period_end: null } },
      { id: 'sub_half', values: { ai_mode: 'managed', ai_monthly_credits: creditsForPayment(3.99), ai_period_start: null, ai_period_end: null } },
    ])
  })

  it('reads every page', async () => {
    const many: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `sub_${i}`, ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS }))
    const state = Object.fromEntries(many.map((r) => [r.id, sub(r.id, 'price_ai_m')]))
    const { supabase } = fakeSupabase(many)

    const result = await resyncAiAllowances({ stripe: fakeStripe(state) as never, supabase: supabase as never, apply: true, pageSize: 2 })

    expect(result.scanned).toBe(5)
    expect(result.unchanged).toBe(5)
  })

  it('counts a failed write as failed, and stops on a failed read', async () => {
    const { supabase } = fakeSupabase([rows[0]], { updateError: { code: '08006' } })
    const result = await resyncAiAllowances({ stripe: fakeStripe(stripeState) as never, supabase: supabase as never, apply: true })
    expect(result.failed).toEqual(['sub_managed'])

    const broken = fakeSupabase(rows, { readError: { code: '57014' } })
    await expect(
      resyncAiAllowances({ stripe: fakeStripe(stripeState) as never, supabase: broken.supabase as never, apply: false })
    ).rejects.toThrow('Reading subscriptions failed (code 57014)')
  })

  it('writes 0 credits for a canceled or unpaid subscription, like the webhook', async () => {
    const { supabase, updates } = fakeSupabase([{ id: 'sub_c', ai_mode: 'managed', ai_monthly_credits: PRO_AI_MONTHLY_CREDITS }])
    const result = await resyncAiAllowances({
      stripe: fakeStripe({ sub_c: sub('sub_c', 'price_ai_m', { status: 'unpaid' }) }) as never,
      supabase: supabase as never,
      apply: true,
    })
    expect(result.changed).toEqual(['sub_c'])
    expect(updates[0].values).toEqual({ ai_mode: 'managed', ai_monthly_credits: 0, ai_period_start: null, ai_period_end: null })
  })

  it('a coupon that cannot be read is a failure for that row only', async () => {
    const stripe = fakeStripe({ sub_half: stripeState.sub_half, sub_ok: stripeState.sub_ok })
    stripe.coupons.retrieve.mockRejectedValueOnce(Object.assign(new Error('down'), { type: 'StripeAPIError' }))
    const { supabase } = fakeSupabase([rows[3], rows[2]])

    const result = await resyncAiAllowances({ stripe: stripe as never, supabase: supabase as never, apply: false })

    expect(result.failed).toEqual(['sub_half'])
    expect(result.unchanged).toBe(1)
  })
})
