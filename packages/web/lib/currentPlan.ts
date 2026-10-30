import { isAiMode, type AiMode } from '@tabmerger/shared'
import { createClient } from '@/lib/supabase/server'
import { getPendingPlanChange } from '@/lib/stripe'
import { getPlanForPriceId, getPriceInfo, type BillingInterval, type PaidTierKey } from '@/lib/tiers'
import { hasCloudSync } from '@/lib/cloudSync'

/**
 * A plan change waiting for the end of the paid period (Stripe's confirm page deferred it, or the
 * server scheduled it), as the pricing page shows it.
 */
export interface PendingPlanChangeInfo {
  /** The plan it moves to; null when its price isn't one this deployment sells. */
  plan: { tierKey: PaidTierKey; interval: BillingInterval; aiMode: AiMode | null } | null
  /** When it takes effect (ISO). */
  effectiveAt: string
}

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
  /** The scheduled plan change, when read (`withPendingChange`) and there is one. */
  pendingChange?: PendingPlanChangeInfo | null
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
 *
 * `withPendingChange` also reads, from Stripe, a plan change already scheduled for the period end
 * (`getPendingPlanChange()`, the account page's source), so the pricing page can show it instead
 * of offering changes the server would refuse (409 `already_scheduled`). Only the user's own
 * subscription on their own customer is read; a failed read leaves `pendingChange` null, as on the
 * account page. Off by default: the home page's teaser doesn't need a Stripe call.
 */
export async function getCurrentPlan({ withPendingChange = false }: { withPendingChange?: boolean } = {}): Promise<CurrentPlan> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return GUEST_PLAN

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, tier, status, stripe_price_id, ai_mode, current_period_end')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!subscription || !hasCloudSync(subscription)) return { signedIn: true, tier: 'free', periodEnd: null }

  const tier = subscription.tier === 'pro_ai' ? 'pro_ai' : 'pro'
  const priceInfo = getPriceInfo(subscription.stripe_price_id)
  const plan: CurrentPlan = {
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
  if (!withPendingChange) return plan
  return { ...plan, pendingChange: await readPendingChange(supabase, user.id, subscription.id) }
}

/** The user's scheduled plan change, or null (none, no billing account, or a failed read). */
async function readPendingChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  subscriptionId: string | null | undefined
): Promise<PendingPlanChangeInfo | null> {
  if (!subscriptionId) return null
  try {
    const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', userId).maybeSingle()
    const customerId = profile?.stripe_customer_id
    if (!customerId) return null
    const pending = await getPendingPlanChange({ customerId, subscriptionId })
    if (!pending) return null
    const target = getPlanForPriceId(pending.priceId)
    return {
      plan: target ? { tierKey: target.tierKey, interval: target.interval, aiMode: target.aiMode } : null,
      effectiveAt: new Date(pending.effectiveAt * 1000).toISOString(),
    }
  } catch {
    return null
  }
}
