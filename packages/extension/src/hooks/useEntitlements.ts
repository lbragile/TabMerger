import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Entitlements, Tier } from '@/lib/types';
import { TIER_LIMITS } from '@/lib/types';
import { useAuth } from './useAuth';

async function fetchTier(userId: string): Promise<Tier> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return 'free';

  const tier = data.tier as string;
  if (tier === 'pro_ai') return 'pro_ai';
  if (tier === 'pro') return 'pro';
  return 'free';
}

// ponytail: demo-mode override for marketing recordings only — same gate as the Settings
// "Demo Mode" button. `pnpm build:extension` runs plain `wxt build` (no VITE_DEMO_BUILD)
// with DEV=false, so this never affects the real Chrome Web Store build.
const DEMO_MODE = import.meta.env.VITE_DEMO_BUILD === 'true';

export function useEntitlements(): Entitlements & { loading: boolean } {
  const { user, loading: authLoading } = useAuth();

  const { data: tier, isLoading } = useQuery({
    queryKey: ['entitlements', user?.id],
    queryFn: () => fetchTier(user!.id),
    enabled: !!user && !DEMO_MODE,
    staleTime: 1000 * 60 * 5
  });

  if (DEMO_MODE) {
    return { ...TIER_LIMITS.pro_ai, loading: false };
  }

  const effectiveTier: Tier = user ? (tier ?? 'free') : 'free';

  return {
    ...TIER_LIMITS[effectiveTier],
    loading: authLoading || (!!user && isLoading)
  };
}
