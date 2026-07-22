import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Entitlements, Tier } from '@/lib/types';
import { TIER_LIMITS } from '@/lib/types';
import { useAuth } from './useAuth';

type SubRow = {
  tier: string;
  status: string;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  stripe_price_id: string | null;
};

/**
 * Maps a raw subscription row to a `Tier` enum value.
 * A `canceled` status is treated as `free` regardless of the tier field,
 * so canceled users immediately lose paid features rather than riding out the period.
 */
function resolveTier(data: SubRow | null): Tier {
  if (!data || data.status === 'canceled') return 'free';
  if (data.tier === 'pro_ai') return 'pro_ai';
  if (data.tier === 'pro') return 'pro';
  return 'free';
}

async function fetchSubscription(userId: string): Promise<SubRow | null> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('tier, status, cancel_at_period_end, current_period_end, stripe_price_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return null;
  return data as SubRow | null;
}

export function isApproachingLimit(
  groupCount: number,
  tabCount: number,
  maxGroups: number,
  maxTabs: number
): boolean {
  /** -1 / -5: warn one item before the hard wall so the upgrade prompt appears before the user is blocked */
  return groupCount >= maxGroups - 1 || tabCount >= maxTabs - 5;
}

export function isOverFreeLimit(itemIndex: number, freeLimit: number): boolean {
  return itemIndex >= freeLimit;
}

// ponytail: demo-mode override for marketing recordings only — same gate as the Settings
// "Demo Mode" button. `pnpm build:extension` runs plain `wxt build` (no VITE_DEMO_BUILD)
// with DEV=false, so this never affects the real Chrome Web Store build.
const DEMO_MODE = import.meta.env.VITE_DEMO_BUILD === 'true';

const POLL_MS = 1000 * 30;

/**
 * Returns the current user's feature limits and subscription metadata.
 * Polls Supabase every 30 s rather than using Realtime, to keep the entitlement path simple and offline-safe.
 * In DEMO_MODE (marketing recordings only), always returns pro_ai limits without hitting Supabase.
 */
export function useEntitlements(): Entitlements & { loading: boolean } {
  const { user, loading: authLoading } = useAuth();

  const { data: sub, isLoading } = useQuery({
    queryKey: ['entitlements', user?.id],
    queryFn: () => fetchSubscription(user!.id),
    enabled: !!user && !DEMO_MODE,
    staleTime: POLL_MS,
    refetchInterval: POLL_MS
  });

  if (DEMO_MODE) {
    return { ...TIER_LIMITS.pro_ai, loading: false };
  }

  const effectiveTier: Tier = user ? resolveTier(sub ?? null) : 'free';

  return {
    ...TIER_LIMITS[effectiveTier],
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    currentPeriodEnd: sub?.current_period_end ?? null,
    subscriptionStatus: sub?.status ?? null,
    /** !!user guard: query is disabled when logged out, so isLoading would be false — but the guard documents intent */
    loading: authLoading || (!!user && isLoading)
  };
}
