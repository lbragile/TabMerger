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

export function useEntitlements(): Entitlements & { loading: boolean } {
  const { user, loading: authLoading } = useAuth();

  const { data: tier, isLoading } = useQuery({
    queryKey: ['entitlements', user?.id],
    queryFn: () => fetchTier(user!.id),
    enabled: !!user,
    staleTime: 1000 * 60 * 5 // refresh every 5 minutes
  });

  const effectiveTier: Tier = user ? (tier ?? 'free') : 'free';

  return {
    ...TIER_LIMITS[effectiveTier],
    loading: authLoading || (!!user && isLoading)
  };
}
