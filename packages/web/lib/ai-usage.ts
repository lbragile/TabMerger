import type { SupabaseClient } from '@supabase/supabase-js'

export const AI_MONTHLY_CAP = 300

/** Per-route credit weight — mirrors Haiku token cost. Imported by ai/*\/route.ts. */
export const CREDIT_COSTS = {
  nameGroup: 1,
  tabSummary: 1,
  suggestSessions: 5,
  groupTabs: 8,
} as const

/** Returns the current month as 'YYYY-MM' in UTC. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/**
 * Effective monthly credit cap = base cap + any credit packs purchased for `month`.
 * Shared by enforcement and by the dashboard/account usage displays so they can't drift.
 */
export async function getEffectiveCap(
  supabase: SupabaseClient,
  userId: string,
  month: string = currentMonth()
): Promise<number> {
  const { data: purchases } = await supabase
    .from('ai_credit_purchases')
    .select('credits')
    .eq('user_id', userId)
    .eq('month', month)

  return (
    AI_MONTHLY_CAP +
    ((purchases as { credits: number }[] | null) ?? []).reduce((sum, p) => sum + p.credits, 0)
  )
}

/**
 * Checks pro_ai subscription, adds `cost` credits to ai_usage, and returns remaining balance.
 * Returns { allowed: false } if not subscribed or the call would exceed the credit pool.
 *
 * ponytail: read-then-update has a small race window but 300 credit/month pool
 * is not a financial boundary — acceptable without a DB-level lock or RPC. The
 * `currentCount + cost > cap` guard (not `>=`) still stops a single expensive
 * call from pushing usage over the pool even if a race lets two calls read stale counts.
 */
export async function checkAndIncrementAIUsage(
  supabase: SupabaseClient,
  userId: string,
  cost: number
): Promise<{ allowed: boolean; remaining: number }> {
  // 1. Verify pro_ai subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', userId)
    .single()

  if (sub?.tier !== 'pro_ai' || sub?.status !== 'active') {
    return { allowed: false, remaining: 0 }
  }

  const month = currentMonth()

  // 2. Read current usage
  const { data: existing } = await supabase
    .from('ai_usage')
    .select('credits_used')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  const currentCount = existing?.credits_used ?? 0

  // 2b. Purchased credit packs extend this month's cap
  const cap = await getEffectiveCap(supabase, userId, month)

  if (currentCount + cost > cap) {
    return { allowed: false, remaining: 0 }
  }

  // 3. Upsert incremented credit total
  await supabase
    .from('ai_usage')
    .upsert(
      { user_id: userId, month, credits_used: currentCount + cost },
      { onConflict: 'user_id,month' }
    )

  return { allowed: true, remaining: cap - (currentCount + cost) }
}
