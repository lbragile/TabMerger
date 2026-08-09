import type { SupabaseClient } from '@supabase/supabase-js'

export const AI_MONTHLY_CAP = 100

/** Returns the current month as 'YYYY-MM' in UTC. */
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

/**
 * Effective monthly cap = base cap + any credit packs purchased for `month`.
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
 * Checks pro_ai subscription, increments ai_usage, and returns remaining count.
 * Returns { allowed: false } if not subscribed or cap exceeded.
 *
 * ponytail: read-then-update has a small race window but 100 req/month cap
 * is not a financial boundary — acceptable without a DB-level lock or RPC.
 */
export async function checkAndIncrementAIUsage(
  supabase: SupabaseClient,
  userId: string
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
    .select('request_count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  const currentCount = existing?.request_count ?? 0

  // 2b. Purchased credit packs extend this month's cap
  const cap = await getEffectiveCap(supabase, userId, month)

  if (currentCount >= cap) {
    return { allowed: false, remaining: 0 }
  }

  // 3. Upsert incremented count
  await supabase
    .from('ai_usage')
    .upsert(
      { user_id: userId, month, request_count: currentCount + 1 },
      { onConflict: 'user_id,month' }
    )

  return { allowed: true, remaining: cap - (currentCount + 1) }
}
