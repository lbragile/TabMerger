import { useQuery } from '@tanstack/react-query';
import { PRO_AI_MONTHLY_CREDITS } from '@tabmerger/shared';
import { supabase } from '@/lib/supabase';
import { getDevAiUsage } from '@/mocks/devAiUsage';
import { AI_ENABLED } from '@/lib/aiFlag';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function fetchUsedCredits(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('credits_used')
    .eq('user_id', userId)
    .eq('month', currentMonth())
    .maybeSingle();

  if (error) throw error;
  return data?.credits_used ?? 0;
}

/**
 * This month's managed allowance: the subscription's `ai_monthly_credits` (set by the server from
 * what the subscription actually pays) plus the credit packs bought this month. Mirrors the web
 * app's `getEffectiveCap`. Throws when either read fails: an unknown cap is not a number to show
 * or to check requests against.
 */
async function fetchEffectiveCap(userId: string): Promise<number> {
  const [subscription, purchases] = await Promise.all([
    supabase.from('subscriptions').select('ai_monthly_credits').eq('user_id', userId).maybeSingle(),
    supabase.from('ai_credit_purchases').select('credits').eq('user_id', userId).eq('month', currentMonth())
  ]);
  if (subscription.error) throw subscription.error;
  if (purchases.error) throw purchases.error;

  const monthly = (subscription.data as { ai_monthly_credits?: unknown } | null)?.ai_monthly_credits;
  const base = typeof monthly === 'number' && Number.isFinite(monthly) ? Math.max(0, monthly) : 0;
  const packs = ((purchases.data as { credits: number }[] | null) ?? []).reduce((sum, p) => sum + (p.credits ?? 0), 0);
  return base + packs;
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

  // ponytail: dev mode reads a local chrome.storage.local counter instead of Supabase —
  // there's usually no real Supabase project configured locally, and this is also the
  // hook for testing AIQuotaExceededPrompt without burning/waiting out a real cap.
  const { data, isLoading } = useQuery({
    queryKey: ['aiUsage', user?.id],
    queryFn: async () => {
      if (import.meta.env.DEV) return { used: await getDevAiUsage(), cap: PRO_AI_MONTHLY_CREDITS };
      const [used, cap] = await Promise.all([fetchUsedCredits(user!.id), fetchEffectiveCap(user!.id)]);
      return { used, cap };
    },
    enabled: AI_ENABLED && aiFeatures && aiMode !== 'byok' && (import.meta.env.DEV || !!user)
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
