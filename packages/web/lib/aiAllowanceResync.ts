import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STORED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared'
import { SUBSCRIPTION_EXPAND, aiWriteColumns, findUnpaidRenewal, subscriptionAiColumns, type CouponPricing, type UnpaidRenewal } from './aiAllowance'
import { getPlanForPriceId } from './tiers'
import { isSetToEndAtPeriodEnd } from './subscriptionEnd'

/**
 * One-off re-sync of `subscriptions.ai_mode` / `ai_monthly_credits` / `ai_period_start` /
 * `ai_period_end` for every `pro_ai` row, from the subscription's current state at Stripe, with the
 * same subscriptionAiColumns() and aiWriteColumns() the webhook writes on every event. Needed once
 * after migration 022, which adds the first two with defaults (`managed`, 0): until a Stripe event
 * rewrites a row, a paying managed subscriber would have a 0 allowance. Needed again after 030,
 * which adds the period columns empty: until they are written, a row's credits stay on the UTC
 * calendar month. Safe to run again: it only writes rows whose values differ. It also repairs a row
 * left behind by a missed `invoice.paid`, and reports it, and leaves a renewal that isn't paid alone.
 *
 * It also rewrites `cancel_at_period_end` on every `pro` and `pro_ai` row with
 * isSetToEndAtPeriodEnd(), the webhook's reading: rows written before it stored only Stripe's flag,
 * so a plan cancelled in the portal on flexible billing mode (`cancel_at` at the period end, flag
 * false) read as renewing. `pro` rows get that column only.
 *
 * Only these columns are written; tier, status and the rest stay the webhook's. Output is
 * counts and Stripe subscription ids only (no emails, user ids or payloads).
 * Run by scripts/resync-ai-allowance.ts (see docs/PAYMENTS.md).
 */

export interface ResyncResult {
  /** `pro` and `pro_ai` rows read. */
  scanned: number
  /** Rows whose stored values already match. */
  unchanged: number
  /** Rows whose values differ (written only with `apply`). */
  changed: string[]
  /** Rows whose renewal isn't paid: the new period stays out of the row until it is. */
  heldOnUnpaid: string[]
  /**
   * Rows whose stored period is behind a paid renewal, among `changed`: an `invoice.paid` was missed
   * (check the endpoint subscribes to it if a row shows up here outside the first backfill).
   */
  behindPaidRenewal: string[]
  /** Rows tracking no Stripe subscription, or one Stripe doesn't have. Left as they are. */
  skipped: string[]
  /** Rows whose subscription or coupon couldn't be read from Stripe, or whose write failed. */
  failed: string[]
}

export interface ResyncOptions {
  stripe: Pick<Stripe, 'subscriptions' | 'coupons' | 'invoices'>
  supabase: Pick<SupabaseClient, 'from'>
  /** Write the new values. Without it nothing is written (dry run). */
  apply: boolean
  log?: (line: string) => void
  /** Rows read per page. */
  pageSize?: number
}

type Row = {
  id: string
  tier: string
  cancel_at_period_end: boolean | null
  ai_mode: string | null
  ai_monthly_credits: number | null
  ai_period_start: string | null
  ai_period_end: string | null
}

const SIGNUP_ROW_PREFIX = 'free_'
const ENDED_STATUS = 'canceled'

/** Whether two stored times are the same instant (the database writes `+00:00`, Stripe's are `Z`). */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b
  return new Date(a).getTime() === new Date(b).getTime()
}

function stripeErrorCode(err: unknown): unknown {
  return (err as { code?: unknown } | null)?.code
}

/**
 * The tier the webhook stores for a status: `free` for `canceled` and for any status the
 * database doesn't store (the webhook's toStoredState()), otherwise the price's tier.
 */
function storedTier(status: string, planTier: string): string {
  if (status === ENDED_STATUS) return 'free'
  return (STORED_SUBSCRIPTION_STATUSES as readonly string[]).includes(status) ? planTier : 'free'
}

export async function resyncAiAllowances({
  stripe,
  supabase,
  apply,
  log = () => {},
  pageSize = 500,
}: ResyncOptions): Promise<ResyncResult> {
  const result: ResyncResult = { scanned: 0, unchanged: 0, changed: [], heldOnUnpaid: [], behindPaidRenewal: [], skipped: [], failed: [] }

  /** Writes `values` to the row; a failed write is listed as failed and returns false. */
  const written = async (id: string, values: Record<string, unknown>): Promise<boolean> => {
    const { error: updateError } = await supabase.from('subscriptions').update(values).eq('id', id)
    if (updateError) result.failed.push(id)
    return !updateError
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, tier, cancel_at_period_end, ai_mode, ai_monthly_credits, ai_period_start, ai_period_end')
      .in('tier', ['pro', 'pro_ai'])
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Reading subscriptions failed (code ${error.code ?? 'unknown'})`)
    const rows = (data ?? []) as Row[]

    for (const row of rows) {
      result.scanned++
      if (!row.id || row.id.startsWith(SIGNUP_ROW_PREFIX)) {
        result.skipped.push(row.id)
        continue
      }

      let subscription: Stripe.Subscription
      try {
        subscription = await stripe.subscriptions.retrieve(row.id, {
          expand: [...SUBSCRIPTION_EXPAND],
        })
      } catch (err) {
        if (stripeErrorCode(err) === 'resource_missing') result.skipped.push(row.id)
        else result.failed.push(row.id)
        continue
      }

      const setToEnd = isSetToEndAtPeriodEnd(subscription)
      const cancelFlag = (row.cancel_at_period_end ?? false) === setToEnd ? {} : { cancel_at_period_end: setToEnd }

      if (row.tier !== 'pro_ai') {
        if (!('cancel_at_period_end' in cancelFlag)) {
          result.unchanged++
          continue
        }
        log(`${row.id}: cancel_at_period_end ${row.cancel_at_period_end ?? false} -> ${setToEnd}`)
        if (apply && !(await written(row.id, cancelFlag))) continue
        result.changed.push(row.id)
        continue
      }

      const plan = getPlanForPriceId(subscription.items?.data?.[0]?.price?.id)
      let columns
      try {
        columns = await subscriptionAiColumns(
          subscription,
          plan,
          storedTier(subscription.status, plan?.tier ?? 'free'),
          {
            retrieveCoupon: async (id): Promise<CouponPricing | null> => {
              try {
                return await stripe.coupons.retrieve(id)
              } catch (err) {
                if (stripeErrorCode(err) === 'resource_missing') return null
                throw err
              }
            },
            onUnpriceableDiscount: (reason) =>
              log(`${row.id}: a discount can't be priced in USD (${reason}); allowance 0`),
          }
        )
      } catch {
        result.failed.push(row.id)
        continue
      }

      // A failed read leaves the row out: it is never written without knowing whether a renewal is unpaid.
      let unpaid: UnpaidRenewal | null
      try {
        unpaid = await findUnpaidRenewal(subscription, stripe.invoices)
      } catch {
        result.failed.push(row.id)
        continue
      }

      const write = aiWriteColumns(subscription, columns, unpaid)
      if (unpaid) {
        result.heldOnUnpaid.push(row.id)
        log(`${row.id}: renewal not paid yet; its period is not stored`)
      }
      if (
        !('cancel_at_period_end' in cancelFlag) &&
        row.ai_mode === write.ai_mode &&
        (write.ai_monthly_credits === undefined || row.ai_monthly_credits === write.ai_monthly_credits) &&
        (write.ai_period_start === undefined || sameInstant(row.ai_period_start ?? null, write.ai_period_start)) &&
        (write.ai_period_end === undefined || sameInstant(row.ai_period_end ?? null, write.ai_period_end))
      ) {
        result.unchanged++
        continue
      }

      if (
        !unpaid &&
        row.ai_period_start &&
        write.ai_period_start &&
        new Date(row.ai_period_start).getTime() < new Date(write.ai_period_start).getTime()
      ) {
        result.behindPaidRenewal.push(row.id)
        log(`${row.id}: stored period is behind a paid renewal`)
      }

      log(
        `${row.id}: ai_mode ${row.ai_mode} -> ${write.ai_mode}, ai_monthly_credits ${row.ai_monthly_credits} -> ${write.ai_monthly_credits ?? 'held'}, ai_period_start ${row.ai_period_start ?? null} -> ${write.ai_period_start === undefined ? 'held' : write.ai_period_start}${'cancel_at_period_end' in cancelFlag ? `, cancel_at_period_end ${row.cancel_at_period_end ?? false} -> ${setToEnd}` : ''}`
      )
      if (apply && !(await written(row.id, { ...write, ...cancelFlag }))) continue
      result.changed.push(row.id)
    }

    if (rows.length < pageSize) break
  }

  return result
}
