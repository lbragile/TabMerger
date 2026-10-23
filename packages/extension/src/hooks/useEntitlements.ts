import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Entitlements, Tier } from '@/lib/types';
import { TIER_LIMITS } from '@/lib/types';
import { AI_BYOK_ENABLED, AI_ENABLED, AI_MANAGED_ENABLED } from '@/lib/aiFlag';
import { resolveAiMode, resolveTier } from '@/lib/entitlementTier';
import { useAuth } from './useAuth';
import { HEARTBEAT_TIER_STORAGE_KEY, type AiMode, type HeartbeatTier } from '@tabmerger/shared';

type SubRow = {
  tier: string;
  status: string;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  stripe_price_id: string | null;
  /** 'managed' | 'byok' since migration 022; absent when the AI columns could not be read. */
  ai_mode?: string | null;
};

const BASE_COLUMNS = 'tier, status, cancel_at_period_end, current_period_end, stripe_price_id';

async function fetchSubscription(userId: string): Promise<SubRow | null> {
  // `ai_mode` is only read while AI is on. If the column can't be read (a database without
  // migration 022), the row is read again without it: a failed read here would otherwise turn
  // every paying user into a free one, and a missing mode just means "managed".
  if (AI_ENABLED) {
    const withAi = await supabase.from('subscriptions').select(`${BASE_COLUMNS}, ai_mode`).eq('user_id', userId).maybeSingle();
    if (!withAi.error) return withAi.data as SubRow | null;
  }
  const { data, error } = await supabase
    .from('subscriptions')
    .select(BASE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return null;
  return data as SubRow | null;
}

/** Whether a Pro AI subscription's option is live in this build (see lib/aiFlag.ts). */
export function isAiModeLive(aiMode: AiMode | null): boolean {
  if (aiMode === 'byok') return AI_BYOK_ENABLED;
  if (aiMode === 'managed') return AI_MANAGED_ENABLED;
  return false;
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

/** The plan last written for the heartbeat in this popup, so a re-render writes nothing. */
let rememberedTier: HeartbeatTier | null = null;

/**
 * Keeps the coarse plan in `chrome.storage.local` for the background worker's daily heartbeat
 * (lib/heartbeat.ts), which must not make a network request to learn it. Only on a change.
 */
function rememberTierForHeartbeat(tier: HeartbeatTier): void {
  if (rememberedTier === tier) return;
  rememberedTier = tier;
  try {
    void Promise.resolve(chrome.storage.local.set({ [HEARTBEAT_TIER_STORAGE_KEY]: tier })).catch(() => {});
  } catch {
    // no extension storage (tests, a non-extension page): nothing to remember
  }
}

/** Test-only: forgets the last plan written for the heartbeat. */
export function _resetRememberedTierForTests(): void {
  rememberedTier = null;
}

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
    // ponytail: AI features: coming soon — the managed AI flag overrides even the
    // marketing-demo tier override below (the demo plays a managed subscriber), so demo
    // recordings never show AI UI while it is off. Flip VITE_AI_ENABLED for a demo build that needs it.
    return { ...TIER_LIMITS.pro_ai, aiFeatures: AI_MANAGED_ENABLED, aiMode: 'managed', loading: false };
  }

  const effectiveTier: Tier = user ? resolveTier(sub ?? null) : 'free';
  const loading = authLoading || (!!user && isLoading);
  if (!loading) rememberTierForHeartbeat(user ? effectiveTier : 'signed_out');

  const aiMode = user ? resolveAiMode(sub ?? null) : null;
  return {
    ...TIER_LIMITS[effectiveTier],
    // ponytail: AI features: coming soon — per-option kill switches. Intentionally ANDed in
    // regardless of the resolved tier: a real pro_ai subscriber must not see AI UI while the
    // flag for THEIR option (own key or TabMerger's key) is off, since this gates unreleased
    // product surface, not per-user entitlement.
    aiFeatures: TIER_LIMITS[effectiveTier].aiFeatures && isAiModeLive(aiMode),
    cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
    currentPeriodEnd: sub?.current_period_end ?? null,
    subscriptionStatus: sub?.status ?? null,
    aiMode,
    /** !!user guard: query is disabled when logged out, so isLoading would be false — but the guard documents intent */
    loading
  };
}
