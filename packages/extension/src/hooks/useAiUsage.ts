import { useQuery } from '@tanstack/react-query';
import { PRO_AI_MONTHLY_CREDITS, aiAllowanceMonth, isAiMode, managedAiCreditsDate, type AiCreditsDate } from '@tabmerger/shared';
import { supabase } from '@/lib/supabase';
import { AI_MANAGED_ENABLED } from '@/lib/aiFlag';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';

/** A whole, positive credit count from a row, else 0 (a missing, null or malformed value). */
function credits(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The `ai_usage` row of `month`: `credits_used`, and `allowance_spent` (how much of that usage the
 * monthly allowance paid for when it was frozen, e.g. on a failed payment). Both 0 without a row.
 */
async function fetchUsageRow(userId: string, month: string): Promise<{ used: number; allowanceSpent: number }> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('credits_used, allowance_spent')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle();

  if (error) throw error;
  const row = data as { credits_used?: unknown; allowance_spent?: unknown } | null;
  return { used: typeof row?.credits_used === 'number' ? row.credits_used : 0, allowanceSpent: credits(row?.allowance_spent) };
}

/**
 * From the user's subscription row:
 * - `allowance`, the managed monthly allowance that counts toward the cap:
 *   `subscriptions.ai_monthly_credits` (set by the server from what the subscription actually pays)
 *   for a `pro_ai` subscription on TabMerger's key (`ai_mode` managed, or unset) whose status is
 *   `active`. Trialing and past_due count 0 here; what the allowance already paid for comes back
 *   through `allowance_spent`.
 * - `month`, the key of the usage rows to show (`aiAllowanceMonth()`, the rule the server meters
 *   with). For display only: the server computes its own and takes none from a client.
 * - `creditsDate`, when those credits reset, or end when the plan is set to cancel then
 *   (`managedAiCreditsDate()`), or null when it isn't known. Only the row's `cancel_at_period_end`
 *   is known here: a plan change scheduled in Stripe isn't on the row, so it reads as a reset.
 */
async function fetchSubscription(userId: string): Promise<{ allowance: number; month: string; creditsDate: AiCreditsDate | null }> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, ai_mode, ai_monthly_credits, ai_period_start, ai_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const sub = data as {
    tier?: unknown;
    status?: unknown;
    ai_mode?: unknown;
    ai_monthly_credits?: unknown;
    ai_period_start?: string | null;
    ai_period_end?: string | null;
    cancel_at_period_end?: boolean | null;
  } | null;
  const managed = !isAiMode(sub?.ai_mode) || sub?.ai_mode === 'managed';
  return {
    allowance: sub?.tier === 'pro_ai' && sub.status === 'active' && managed ? credits(sub.ai_monthly_credits) : 0,
    month: aiAllowanceMonth(sub?.ai_period_start, sub?.ai_period_end),
    creditsDate: managedAiCreditsDate(sub)
  };
}

/** Credits of the credit packs of `month` that still count: a revoked pack (disputed or refunded) counts for nothing. */
async function fetchPackCredits(userId: string, month: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_credit_purchases')
    .select('credits')
    .eq('user_id', userId)
    .eq('month', month)
    .is('revoked_at', null);
  if (error) throw error;
  return ((data as { credits?: unknown }[] | null) ?? []).reduce((sum, p) => sum + credits(p.credits), 0);
}

/**
 * The current allowance month's credits used and managed cap. The cap mirrors the server's
 * (`ai_credit_cap`, migrations 027 and 030, and the web app's `getEffectiveCap`): greatest(active
 * allowance, `allowance_spent`) + the month's unrevoked credit packs. So a past_due user sees what
 * the frozen allowance already paid for plus their packs, not 0. Throws when any read fails: an
 * unknown cap is not a number to show or to check requests against.
 */
async function fetchUsage(userId: string): Promise<{ used: number; cap: number; creditsDate: AiCreditsDate | null }> {
  const { allowance, month, creditsDate } = await fetchSubscription(userId);
  const [usage, packs] = await Promise.all([fetchUsageRow(userId, month), fetchPackCredits(userId, month)]);
  return { used: usage.used, cap: Math.max(0, Math.max(allowance, usage.allowanceSpent) + packs), creditsDate };
}

/**
 * Remaining managed AI credits for the current allowance month (it starts when a paid billing period
 * starts, see `aiAllowanceMonth()`), Pro AI "managed" users only (a
 * BYOK user pays Anthropic directly and has no credits, so nothing is read for them).
 * Mirrors the web app's account page usage indicator (same `ai_usage` table + cap).
 *
 * `known` is false until the numbers have been read (and when the read failed): the counts then
 * fall back to a full advertised allowance, for display only, and callers must not refuse a
 * request on them. `creditsDate` is when the credits reset or end; null means unknown, so show no date.
 */
export function useAiUsage() {
  const { user } = useAuth();
  const { aiFeatures, aiMode } = useEntitlements();

  // Dev builds read the real tables too: the web dev server's AI_MOCK replies charge real
  // credits, and Settings > Dev sets `credits_used` through /api/ai/dev-usage.
  const { data, isLoading } = useQuery({
    queryKey: ['aiUsage', user?.id],
    queryFn: () => fetchUsage(user!.id),
    // Credits exist only on TabMerger's key, so only while that option is live
    enabled: AI_MANAGED_ENABLED && aiFeatures && aiMode !== 'byok' && !!user
  });

  const used = data?.used ?? 0;
  const cap = data?.cap ?? PRO_AI_MONTHLY_CREDITS;

  return {
    used,
    remaining: Math.max(0, cap - used),
    cap,
    loading: isLoading,
    known: !!data,
    creditsDate: data?.creditsDate ?? null
  };
}
