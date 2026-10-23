import { NextResponse } from 'next/server'
import { aiAvailability, isAiMode, type AiMode } from '@tabmerger/shared'
import { createPlanSwitchSession, PlanSwitchError } from '@/lib/stripe'
import {
  getPlanPriceIds,
  getPriceInfo,
  getStripePriceId,
  type BillingInterval,
  type PaidTierKey,
} from '@/lib/tiers'
import { hasCloudSync } from '@/lib/cloudSync'
import { AI_DISABLED_ERROR } from '@/lib/ai-guard'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { absoluteUrl } from '@/lib/utils'

export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly']

export function isBillingInterval(value: unknown): value is BillingInterval {
  return BILLING_INTERVALS.includes(value as BillingInterval)
}

/** What the caller wants to change. A field left out keeps the subscription's current value. */
export interface PlanSwitchTarget {
  interval?: BillingInterval
  /** Pro AI only: TabMerger's key (`managed`) or the customer's own (`byok`). */
  aiMode?: AiMode
}

/**
 * Reads a plan-switch request body: `{ interval?, aiMode? }`, at least one of them, each a known
 * value. Returns the target, or the message for a 400.
 */
export function parsePlanSwitchBody(body: unknown): PlanSwitchTarget | { error: string } {
  const { interval, aiMode } = (body && typeof body === 'object' ? body : {}) as {
    interval?: unknown
    aiMode?: unknown
  }
  if (interval === undefined && aiMode === undefined) {
    return { error: 'Send interval ("monthly" or "yearly") and/or aiMode ("managed" or "byok")' }
  }
  const target: PlanSwitchTarget = {}
  if (interval !== undefined) {
    if (!isBillingInterval(interval)) return { error: 'interval must be "monthly" or "yearly"' }
    target.interval = interval
  }
  if (aiMode !== undefined) {
    if (!isAiMode(aiMode)) return { error: 'aiMode must be "managed" or "byok"' }
    target.aiMode = aiMode
  }
  return target
}

/**
 * Moves the signed-in user's paid subscription to another Price of the same plan by returning a
 * Billing Portal URL that opens on Stripe's "confirm plan change" page: another billing interval
 * (monthly ↔ yearly) and/or, for Pro AI, the other AI option (TabMerger's key ↔ own key). The
 * tier never changes here, so this can't reach a different (or unreleased) plan. The
 * subscription row is written by the webhook once Stripe confirms, never here.
 *
 * Responds `{ url }`, or 401, 403 (no paid plan; an AI option for a plan without AI), 400 (no
 * billing account; the current interval is unknown and none was sent), 409 (already on that
 * price, or a change is already scheduled; `error` is shown to the user), 503 (`ai_disabled`: the
 * Pro AI option the subscription would be on isn't on sale per aiAvailability(); or the target
 * price is not configured), 500.
 */
export async function startPlanSwitch(target: PlanSwitchTarget): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('tier, status, stripe_price_id, ai_mode')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!hasCloudSync(subscription)) {
    return NextResponse.json({ error: 'No paid plan to switch' }, { status: 403 })
  }

  const tierKey: PaidTierKey = subscription!.tier === 'pro_ai' ? 'proAi' : 'pro'

  if (target.aiMode !== undefined && tierKey !== 'proAi') {
    return NextResponse.json({ error: 'Only Pro AI has this option' }, { status: 403 })
  }

  // What the subscription is on now. The price is the authority (the webhook derives the row's
  // ai_mode from it); the stored ai_mode covers a price this environment doesn't know.
  const current = getPriceInfo(subscription!.stripe_price_id)
  const interval = target.interval ?? current?.interval
  if (!interval) {
    return NextResponse.json({ error: 'interval is required for this plan' }, { status: 400 })
  }
  const storedMode = (subscription as { ai_mode?: unknown }).ai_mode
  const aiMode: AiMode =
    target.aiMode ?? current?.aiMode ?? (isAiMode(storedMode) ? storedMode : 'managed')

  // A Pro AI option is switched to (or kept, on an interval switch) only while it is on sale, like
  // the Pro AI checkout: managed needs the managed flag, own key needs either flag.
  if (
    tierKey === 'proAi' &&
    !aiAvailability(process.env.NEXT_PUBLIC_AI_ENABLED, process.env.NEXT_PUBLIC_AI_BYOK_ENABLED)[aiMode]
  ) {
    return NextResponse.json({ error: AI_DISABLED_ERROR }, { status: 503 })
  }

  const targetPriceId = getStripePriceId(tierKey, interval, aiMode)
  if (!targetPriceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 503 })
  }
  // Every Price of the tier, both options: the subscription is found whichever one it is on.
  const planPriceIds = getPlanPriceIds(tierKey)

  const serviceClient = await createServiceRoleClient()
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()
  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 })
  }

  try {
    const url = await createPlanSwitchSession({
      customerId: profile.stripe_customer_id,
      targetPriceId,
      planPriceIds,
      returnUrl: absoluteUrl('/account'),
    })
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof PlanSwitchError) {
      if (err.reason === 'already_on_price') {
        const message =
          target.aiMode === undefined
            ? `You're already billed ${interval}.`
            : "You're already on that plan."
        return NextResponse.json({ error: message }, { status: 409 })
      }
      if (err.reason === 'already_scheduled') {
        return NextResponse.json(
          { error: 'A billing change is already scheduled for the end of this term.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'No paid plan to switch' }, { status: 403 })
    }
    console.error('Plan switch error:', err)
    return NextResponse.json({ error: 'Failed to start the plan change' }, { status: 500 })
  }
}
