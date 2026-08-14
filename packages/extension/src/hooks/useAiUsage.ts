import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getDevAiUsage } from '@/mocks/devAiUsage';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';

// ponytail: duplicated from packages/web/lib/ai-usage.ts rather than shared — that
// file also exports a service-role usage-incrementing function which must stay
// server-only. Keep this constant in sync if AI_MONTHLY_CAP ever changes.
export const AI_MONTHLY_CAP = 300;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function fetchUsageCount(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('credits_used')
    .eq('user_id', userId)
    .eq('month', currentMonth())
    .maybeSingle();

  if (error) return 0;
  return data?.credits_used ?? 0;
}

/** Base cap + credit packs purchased for the current month (mirrors web's getEffectiveCap). */
async function fetchEffectiveCap(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_credit_purchases')
    .select('credits')
    .eq('user_id', userId)
    .eq('month', currentMonth());

  if (error) return AI_MONTHLY_CAP;
  return (
    AI_MONTHLY_CAP +
    ((data as { credits: number }[] | null) ?? []).reduce((sum, p) => sum + p.credits, 0)
  );
}

/**
 * Returns remaining AI credits for the current calendar month, Pro AI users only.
 * Mirrors the web app's account page usage indicator (same `ai_usage` table + cap).
 */
export function useAiUsage() {
  const { user } = useAuth();
  const { aiFeatures } = useEntitlements();

  // ponytail: dev mode reads a local chrome.storage.local counter instead of Supabase —
  // there's usually no real Supabase project configured locally, and this is also the
  // hook for testing AIQuotaExceededPrompt without burning/waiting out a real cap.
  const { data, isLoading } = useQuery({
    queryKey: ['aiUsage', user?.id],
    queryFn: async () => {
      if (import.meta.env.DEV) return { used: await getDevAiUsage(), cap: AI_MONTHLY_CAP };
      const [used, cap] = await Promise.all([
        fetchUsageCount(user!.id),
        fetchEffectiveCap(user!.id)
      ]);
      return { used, cap };
    },
    enabled: import.meta.env.DEV ? aiFeatures : !!user && aiFeatures
  });

  const used = data?.used ?? 0;
  const cap = data?.cap ?? AI_MONTHLY_CAP;

  return {
    used,
    remaining: cap - used,
    cap,
    loading: isLoading
  };
}
