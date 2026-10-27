import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PRO_AI_MONTHLY_CREDITS,
  isAiMode,
  isEntitledSubscriptionStatus,
  type AiMode,
} from '@tabmerger/shared'

/**
 * Pro AI plan and credit accounting for the `/api/ai/*` routes and the usage displays.
 *
 * Credits are a cost unit (1 credit = $0.001 of Anthropic list-price cost, see
 * `aiCallCredits` in `@tabmerger/shared`). A managed call reserves its worst-case cost before
 * it runs and settles to the real cost afterwards, through two service-role-only database
 * functions (migration 022) that check and write in one statement, so concurrent calls can
 * never spend past the cap. BYOK calls are never metered.
 */

/**
 * @deprecated Use `PRO_AI_MONTHLY_CREDITS` from `@tabmerger/shared`. Kept while
 * `components/pricing/PricingCard.tsx` still imports it.
 */
export const AI_MONTHLY_CAP = PRO_AI_MONTHLY_CREDITS

/** Returns the current month as 'YYYY-MM' in UTC, the bucket `ai_usage` rows are keyed by. */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/** The subscription fields AI routes branch on. */
export interface AiSubscription {
  tier: string | null
  status: string | null
  /** `managed` when the column is missing or holds anything unexpected (the column default). */
  aiMode: AiMode
  /** Managed monthly allowance in credits; 0 when unset. */
  monthlyCredits: number
}

interface SubscriptionRow {
  tier?: string | null
  status?: string | null
  ai_mode?: unknown
  ai_monthly_credits?: unknown
}

/** Reads a `subscriptions` row (any of tier, status, ai_mode, ai_monthly_credits) as an {@link AiSubscription}. */
export function toAiSubscription(row: SubscriptionRow | null | undefined): AiSubscription | null {
  if (!row) return null
  const credits = row.ai_monthly_credits
  return {
    tier: row.tier ?? null,
    status: row.status ?? null,
    aiMode: isAiMode(row.ai_mode) ? row.ai_mode : 'managed',
    monthlyCredits: typeof credits === 'number' && Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0,
  }
}

/** Reads the user's subscription row (tier, status, AI option and allowance), or `null`. */
export async function getAiSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<AiSubscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, ai_mode, ai_monthly_credits')
    .eq('user_id', userId)
    .single()
  return toAiSubscription(data as SubscriptionRow | null)
}

/**
 * Whether a subscription may use AI at all: tier `pro_ai` with an entitled status
 * (`active`, `trialing` or `past_due`, the same list cloud sync uses).
 */
export function hasProAi(sub: AiSubscription | null): sub is AiSubscription {
  return sub?.tier === 'pro_ai' && isEntitledSubscriptionStatus(sub.status)
}

/**
 * Effective monthly credit cap = the subscription's managed allowance
 * (`subscriptions.ai_monthly_credits`, counted only for an entitled managed `pro_ai`
 * subscription, as `ai_reserve_credits` does) + any credit packs bought for `month`.
 * Shared by the dashboard and account usage displays so they show what the server enforces.
 */
export async function getEffectiveCap(
  supabase: SupabaseClient,
  userId: string,
  month: string = currentMonth()
): Promise<number> {
  const sub = await getAiSubscription(supabase, userId)
  const base = hasProAi(sub) && sub.aiMode === 'managed' ? sub.monthlyCredits : 0

  const { data: purchases } = await supabase
    .from('ai_credit_purchases')
    .select('credits')
    .eq('user_id', userId)
    .eq('month', month)

  return base + ((purchases as { credits: number }[] | null) ?? []).reduce((sum, p) => sum + p.credits, 0)
}

/** Result of {@link reserveCredits}. `remaining` is after the reservation when allowed. */
export interface CreditReservation {
  allowed: boolean
  remaining: number
  cap: number
}

/**
 * Atomically reserves `amount` credits for `(userId, month)` through `ai_reserve_credits`.
 * Not allowed (and nothing written) when the reservation would pass the cap. Throws when the
 * database call fails, so the route refuses the request rather than running it unmetered.
 */
export async function reserveCredits(
  supabase: SupabaseClient,
  userId: string,
  month: string,
  amount: number
): Promise<CreditReservation> {
  const { data, error } = await supabase.rpc('ai_reserve_credits', {
    p_user: userId,
    p_month: month,
    p_amount: amount,
  })
  if (error) throw new Error(`ai_reserve_credits failed: ${error.message}`)

  // A set-returning function comes back as an array of rows.
  const row = (Array.isArray(data) ? data[0] : data) as Partial<CreditReservation> | null | undefined
  if (!row || typeof row.allowed !== 'boolean') throw new Error('ai_reserve_credits returned no row')
  return {
    allowed: row.allowed,
    remaining: Number(row.remaining ?? 0),
    cap: Number(row.cap ?? 0),
  }
}

/**
 * Adds `delta` (usually negative: actual cost minus the reservation) to this month's usage
 * through `ai_settle_credits`, never below 0. Returns the new `credits_used`, or `null` when
 * there was no row. Throws when the database call fails; callers keep the reservation then.
 */
export async function settleCredits(
  supabase: SupabaseClient,
  userId: string,
  month: string,
  delta: number
): Promise<number | null> {
  const { data, error } = await supabase.rpc('ai_settle_credits', {
    p_user: userId,
    p_month: month,
    p_delta: delta,
  })
  if (error) throw new Error(`ai_settle_credits failed: ${error.message}`)
  return typeof data === 'number' ? data : null
}
