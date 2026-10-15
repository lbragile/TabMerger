import { isEntitledSubscriptionStatus } from '@tabmerger/shared';
import { supabase } from '@/lib/supabase';
import type { Tier } from '@/lib/types';

/** The `subscriptions` columns tier resolution reads. */
export interface SubscriptionTierRow {
  tier: string;
  status: string;
}

/**
 * Maps a raw subscription row to a `Tier` enum value.
 * Only `ENTITLED_SUBSCRIPTION_STATUSES` (active, trialing, past_due) grant paid
 * entitlements — every other status (canceled, incomplete, incomplete_expired,
 * unpaid, paused) is treated as `free` regardless of the tier field. Mirrors
 * `has_cloud_sync()` in supabase/migrations/019_gate_cloud_sync_rls.sql.
 *
 * Pure, and shared by the popup (`useEntitlements`) and the background worker (automatic
 * backups), so the two can never disagree on who is paid.
 */
export function resolveTier(data: SubscriptionTierRow | null | undefined): Tier {
  if (!data || !isEntitledSubscriptionStatus(data.status)) return 'free';
  if (data.tier === 'pro_ai') return 'pro_ai';
  if (data.tier === 'pro') return 'pro';
  return 'free';
}

/**
 * The signed-in user's tier, read from the server, for code that runs without React (the
 * background worker). Resolves `null` when the check itself failed (offline, timeout, 401, 5xx):
 * that is "unknown", NOT "free" and NOT "paid", and callers that gate a paid action must not run
 * it. A user with no subscription row is `free`.
 */
export async function fetchTier(userId: string): Promise<Tier | null> {
  try {
    const { data, error } = await supabase.from('subscriptions').select('tier, status').eq('user_id', userId).maybeSingle();
    if (error) return null;
    return resolveTier(data as SubscriptionTierRow | null);
  } catch {
    return null;
  }
}
