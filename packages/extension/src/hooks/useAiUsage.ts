import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';
import { useEntitlements } from './useEntitlements';

// ponytail: duplicated from packages/web/lib/ai-usage.ts rather than shared — that
// file also exports a service-role usage-incrementing function which must stay
// server-only. Keep this constant in sync if AI_MONTHLY_CAP ever changes.
export const AI_MONTHLY_CAP = 100;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

async function fetchUsageCount(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('request_count')
    .eq('user_id', userId)
    .eq('month', currentMonth())
    .maybeSingle();

  if (error) return 0;
  return data?.request_count ?? 0;
}

/**
 * Returns remaining AI calls for the current calendar month, Pro AI users only.
 * Mirrors the web app's account page usage indicator (same `ai_usage` table + cap).
 */
export function useAiUsage() {
  const { user } = useAuth();
  const { aiFeatures } = useEntitlements();

  const { data: used, isLoading } = useQuery({
    queryKey: ['aiUsage', user?.id],
    queryFn: () => fetchUsageCount(user!.id),
    enabled: !!user && aiFeatures
  });

  return {
    used: used ?? 0,
    remaining: AI_MONTHLY_CAP - (used ?? 0),
    cap: AI_MONTHLY_CAP,
    loading: isLoading
  };
}
