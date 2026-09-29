import { isEntitledSubscriptionStatus } from '@tabmerger/shared'

export type SubscriptionTier = 'free' | 'pro' | 'pro_ai'

export interface CloudSyncSubscription {
  tier?: SubscriptionTier | string | null
  status?: string | null
}

/**
 * Single source of truth for "does this account get cloud sync (and therefore
 * everything downstream of it — Tab Groups, Saved Sessions, the sync pill)".
 *
 * Matches the RLS gate in supabase/migrations/019_gate_cloud_sync_rls.sql: a
 * paid tier alone isn't enough — the subscription status must also be one of
 * ENTITLED_SUBSCRIPTION_STATUSES (active/trialing/past_due), otherwise an
 * incomplete/unpaid/canceled paid-tier row must be treated the same as free.
 */
export function hasCloudSync(subscription: CloudSyncSubscription | null | undefined): boolean {
  const tier = subscription?.tier
  const isPaidTier = tier === 'pro' || tier === 'pro_ai'
  return isPaidTier && isEntitledSubscriptionStatus(subscription?.status)
}
