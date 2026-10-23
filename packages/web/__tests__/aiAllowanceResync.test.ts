/**
 * Tests for lib/aiAllowanceResync.ts, the one-off re-sync of `ai_mode` / `ai_monthly_credits`
 * for existing pro_ai rows (run by scripts/resync-ai-allowance.ts after migration 022). Stripe and
 * Supabase are fakes: nothing here talks to a real project.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { creditsForPayment } from '@tabmerger/shared'
import { resyncAiAllowances } from '@/lib/aiAllowanceResync'

type Row = { id: string; ai_mode: string | null; ai_monthly_credits: number | null }

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
    { id: 'sub_ok', ai_mode: 'managed', ai_monthly_credits: 2600 },
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

  it('--apply writes the same values the webhook would, to those rows only', async () => {
    const { supabase, updates } = fakeSupabase(rows)

    const result = await resyncAiAllowances({ stripe: fakeStripe(stripeState) as never, supabase: supabase as never, apply: true })

    expect(result.changed).toEqual(['sub_managed', 'sub_byok', 'sub_half'])
    expect(updates).toEqual([
      { id: 'sub_managed', values: { ai_mode: 'managed', ai_monthly_credits: 2600 } },
      { id: 'sub_byok', values: { ai_mode: 'byok', ai_monthly_credits: 0 } },
      { id: 'sub_half', values: { ai_mode: 'managed', ai_monthly_credits: creditsForPayment(3.99) } },
    ])
  })

  it('reads every page', async () => {
    const many: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `sub_${i}`, ai_mode: 'managed', ai_monthly_credits: 2600 }))
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
    const { supabase, updates } = fakeSupabase([{ id: 'sub_c', ai_mode: 'managed', ai_monthly_credits: 2600 }])
    const result = await resyncAiAllowances({
      stripe: fakeStripe({ sub_c: sub('sub_c', 'price_ai_m', { status: 'unpaid' }) }) as never,
      supabase: supabase as never,
      apply: true,
    })
    expect(result.changed).toEqual(['sub_c'])
    expect(updates[0].values).toEqual({ ai_mode: 'managed', ai_monthly_credits: 0 })
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
