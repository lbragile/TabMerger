import { useQuery } from '@tanstack/react-query';
import { PRO_AI_MONTHLY_CREDITS, isAiMode } from '@tabmerger/shared';
import { supabase } from '@/lib/supabase';
import { AI_MANAGED_ENABLED } from '@/lib/aiFlag';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** A whole, positive credit count from a row, else 0 (a missing, null or malformed value). */
function credits(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * This month's `ai_usage` row: `credits_used`, and `allowance_spent` (how much of that usage the
 * monthly allowance paid for when it was frozen, e.g. on a failed payment). Both 0 without a row.
 */
async function fetchUsageRow(userId: string): Promise<{ used: number; allowanceSpent: number }> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('credits_used, allowance_spent')
    .eq('user_id', userId)
    .eq('month', currentMonth())
    .maybeSingle();

  if (error) throw error;
  const row = data as { credits_used?: unknown; allowance_spent?: unknown } | null;
  return { used: typeof row?.credits_used === 'number' ? row.credits_used : 0, allowanceSpent: credits(row?.allowance_spent) };
}

/**
 * The managed monthly allowance that counts toward the cap: `subscriptions.ai_monthly_credits`
 * (set by the server from what the subscription actually pays) for a `pro_ai` subscription on
 * TabMerger's key (`ai_mode` managed, or unset) whose status is `active`. Trialing and past_due
 * count 0 here; what the allowance already paid for comes back through `allowance_spent`.
 */
async function fetchActiveAllowance(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, ai_mode, ai_monthly_credits')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const sub = data as { tier?: unknown; status?: unknown; ai_mode?: unknown; ai_monthly_credits?: unknown } | null;
  const managed = !isAiMode(sub?.ai_mode) || sub?.ai_mode === 'managed';
  return sub?.tier === 'pro_ai' && sub.status === 'active' && managed ? credits(sub.ai_monthly_credits) : 0;
}

/** Credits of this month's credit packs that still count: a revoked pack (disputed or refunded) counts for nothing. */
async function fetchPackCredits(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_credit_purchases')
    .select('credits')
    .eq('user_id', userId)
    .eq('month', currentMonth())
    .is('revoked_at', null);
  if (error) throw error;
  return ((data as { credits?: unknown }[] | null) ?? []).reduce((sum, p) => sum + credits(p.credits), 0);
}

/**
 * This month's credits used and managed cap. The cap mirrors the server's (`ai_reserve_credits`,
 * migration 027, and the web app's `getEffectiveCap`): greatest(active allowance,
 * `allowance_spent`) + the month's unrevoked credit packs. So a past_due user sees what the
 * frozen allowance already paid for plus their packs, not 0. Throws when any read fails: an
 * unknown cap is not a number to show or to check requests against.
 */
async function fetchUsage(userId: string): Promise<{ used: number; cap: number }> {
  const [usage, allowance, packs] = await Promise.all([fetchUsageRow(userId), fetchActiveAllowance(userId), fetchPackCredits(userId)]);
  return { used: usage.used, cap: Math.max(0, Math.max(allowance, usage.allowanceSpent) + packs) };
}

/**
 * Remaining managed AI credits for the current calendar month, Pro AI "managed" users only (a
 * BYOK user pays Anthropic directly and has no credits, so nothing is read for them).
 * Mirrors the web app's account page usage indicator (same `ai_usage` table + cap).
 *
 * `known` is false until the numbers have been read (and when the read failed): the counts then
 * fall back to a full advertised allowance, for display only, and callers must not refuse a
 * request on them.
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
    known: !!data
  };
}
