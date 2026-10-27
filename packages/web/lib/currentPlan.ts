import { isAiMode, type AiMode } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { getPriceInfo, type BillingInterval } from '@/lib/tiers'
import { hasCloudSync } from '@/lib/cloudSync'

/** The visitor's plan as the plan listings (pricing page, home teaser) show it. */
export interface CurrentPlan {
  signedIn: boolean
  /** `free` for a guest, a free account, or a paid subscription that isn't entitled. */
  tier: 'free' | 'pro' | 'pro_ai'
  /** How the paid plan is billed; undefined for free or a price this deployment doesn't know. */
  interval?: BillingInterval
  /** Pro AI only: TabMerger's AI or the subscriber's own key. */
  aiMode?: AiMode
  /** When the paid period ends (the date a scheduled plan change takes effect). */
  periodEnd: string | null
}

/** A signed-out visitor. */
export const GUEST_PLAN: CurrentPlan = { signedIn: false, tier: 'free', periodEnd: null }

/**
 * The signed-in user's plan, read on the server for this request (reads the session cookie, so
 * the calling route renders per request).
 *
 * A paid tier counts only while its status is entitled (`hasCloudSync`: active, trialing,
 * past_due), the same rule as RLS and the rest of the product; anything else is `free`. Server
 * only: the Stripe price ids that tell the interval apart are server-side env vars.
 */
export async function getCurrentPlan(): Promise<CurrentPlan> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return GUEST_PLAN

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status, stripe_price_id, ai_mode, current_period_end')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!subscription || !hasCloudSync(subscription)) return { signedIn: true, tier: 'free', periodEnd: null }

  const tier = subscription.tier === 'pro_ai' ? 'pro_ai' : 'pro'
  const priceInfo = getPriceInfo(subscription.stripe_price_id)
  return {
    signedIn: true,
    tier,
    interval: priceInfo?.interval,
    periodEnd: subscription.current_period_end ?? null,
    // Pro AI's option: the price says which it is; the stored column covers a price this
    // deployment doesn't know.
    aiMode:
      tier === 'pro_ai'
        ? (priceInfo?.aiMode ?? (isAiMode(subscription.ai_mode) ? subscription.ai_mode : 'managed'))
        : undefined,
  }
}
