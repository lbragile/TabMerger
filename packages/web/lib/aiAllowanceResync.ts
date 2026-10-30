import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STORED_SUBSCRIPTION_STATUSES } from '@tabmerger/shared'
import { SUBSCRIPTION_EXPAND, subscriptionAiColumns, type CouponPricing } from './aiAllowance'
import { getPlanForPriceId } from './tiers'

/**
 * One-off re-sync of `subscriptions.ai_mode` / `ai_monthly_credits` for every `pro_ai` row, from
 * the subscription's current state at Stripe, with the same subscriptionAiColumns() the webhook
 * writes on every event. Needed once after migration 022, which adds the columns with defaults
 * (`managed`, 0): until a Stripe event rewrites a row, a paying managed subscriber would have a
 * 0 allowance. Safe to run again: it only writes rows whose values differ.
 *
 * Only these two columns are written; tier, status and the rest stay the webhook's. Output is
 * counts and Stripe subscription ids only (no emails, user ids or payloads).
 * Run by scripts/resync-ai-allowance.ts (see docs/PAYMENTS.md).
 */

export interface ResyncResult {
  /** `pro_ai` rows read. */
  scanned: number
  /** Rows whose stored values already match. */
  unchanged: number
  /** Rows whose values differ (written only with `apply`). */
  changed: string[]
  /** Rows tracking no Stripe subscription, or one Stripe doesn't have. Left as they are. */
  skipped: string[]
  /** Rows whose subscription or coupon couldn't be read from Stripe, or whose write failed. */
  failed: string[]
}

export interface ResyncOptions {
  stripe: Pick<Stripe, 'subscriptions' | 'coupons'>
  supabase: Pick<SupabaseClient, 'from'>
  /** Write the new values. Without it nothing is written (dry run). */
  apply: boolean
  log?: (line: string) => void
  /** Rows read per page. */
  pageSize?: number
}

type Row = { id: string; ai_mode: string | null; ai_monthly_credits: number | null }

const SIGNUP_ROW_PREFIX = 'free_'
const ENDED_STATUS = 'canceled'

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
  const result: ResyncResult = { scanned: 0, unchanged: 0, changed: [], skipped: [], failed: [] }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('id, ai_mode, ai_monthly_credits')
      .eq('tier', 'pro_ai')
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

      if (row.ai_mode === columns.aiMode && row.ai_monthly_credits === columns.monthlyCredits) {
        result.unchanged++
        continue
      }

      log(
        `${row.id}: ai_mode ${row.ai_mode} -> ${columns.aiMode}, ai_monthly_credits ${row.ai_monthly_credits} -> ${columns.monthlyCredits}`
      )
      if (apply) {
        const { error: updateError } = await supabase
          .from('subscriptions')
          .update({ ai_mode: columns.aiMode, ai_monthly_credits: columns.monthlyCredits })
          .eq('id', row.id)
        if (updateError) {
          result.failed.push(row.id)
          continue
        }
      }
      result.changed.push(row.id)
    }

    if (rows.length < pageSize) break
  }

  return result
}
