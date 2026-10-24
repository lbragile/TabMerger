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
import {
  PLAN_SWITCH_ERROR_CODES as CODES,
  type PlanSwitchCheckoutTarget,
} from '@/lib/checkoutErrors'
import {
  SubscriptionSyncError,
  resyncEndedSubscription,
  type ServiceRoleClient,
} from '@/lib/subscriptionSync'

export const BILLING_INTERVALS: readonly BillingInterval[] = ['monthly', 'yearly']

export function isBillingInterval(value: unknown): value is BillingInterval {
  return BILLING_INTERVALS.includes(value as BillingInterval)
}

export const PAID_TIER_KEYS: readonly PaidTierKey[] = ['pro', 'proAi']

export function isPaidTierKey(value: unknown): value is PaidTierKey {
  return PAID_TIER_KEYS.includes(value as PaidTierKey)
}

/** What the caller wants to change. A field left out keeps the subscription's current value. */
export interface PlanSwitchTarget {
  /** The plan, by its wire name (`proAi`, never the database's `pro_ai`). */
  tier?: PaidTierKey
  interval?: BillingInterval
  /** Pro AI only: TabMerger's key (`managed`) or the customer's own (`byok`). */
  aiMode?: AiMode
}

/**
 * Reads a plan-switch request body: `{ tier?, interval?, aiMode? }`, at least one of them, each a
 * known value. Returns the target, or the message for a 400.
 */
export function parsePlanSwitchBody(body: unknown): PlanSwitchTarget | { error: string } {
  const { tier, interval, aiMode } = (body && typeof body === 'object' ? body : {}) as {
    tier?: unknown
    interval?: unknown
    aiMode?: unknown
  }
  if (tier === undefined && interval === undefined && aiMode === undefined) {
    return {
      error:
        'Send tier ("pro" or "proAi"), interval ("monthly" or "yearly") and/or aiMode ("managed" or "byok")',
    }
  }
  const target: PlanSwitchTarget = {}
  if (tier !== undefined) {
    if (!isPaidTierKey(tier)) return { error: 'tier must be "pro" or "proAi"' }
    target.tier = tier
  }
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
 * Moves the signed-in user's paid subscription to another Price: another billing interval
 * (monthly ↔ yearly), the other Pro AI option (TabMerger's key ↔ own key) and/or the other plan
 * (Pro ↔ Pro AI). The timing follows the refund policy (`createPlanSwitchSession()` in
 * lib/stripe.ts): an upgrade is confirmed on Stripe's "confirm plan change" page and charged now,
 * prorated; a downgrade or shorter interval takes effect at the end of the paid period with no
 * refund or credit. The subscription row is written by the webhook once Stripe changes the price,
 * never here.
 *
 * Responds with one of:
 * - `{ url }`: Stripe's "confirm plan change" page (the portal);
 * - `{ applied: 'end_of_period', effectiveAt, url }`: scheduled by the server; `effectiveAt` is an
 *   ISO date and `url` the account page;
 *
 * or an error `{ error, code? }` (`code` from PLAN_SWITCH_ERROR_CODES in lib/checkoutErrors.ts):
 * 401, 403 (`no_paid_plan`; an AI option for Pro), 400 (`no_billing_account`, also when Stripe
 * has no such customer; a bad body; the current interval is unknown and none was sent), 409
 * (`already_on_price`, `already_scheduled`, `cancel_scheduled`), 503 (`ai_disabled` in `error`: the Pro AI option the subscription would be
 * on isn't on sale per aiAvailability(); `price_unavailable`: the target price isn't configured
 * here or is archived in Stripe), 500 (`switch_failed`, logged with the Stripe error's type, code
 * and request id).
 *
 * The row can say "paid" when Stripe says the plan has ended: a webhook delivery that was missed
 * or failed. When Stripe has no entitled subscription for the customer at all, the row is
 * corrected from Stripe (correctEndedPlan()) and the 403 `no_paid_plan` also carries `checkout`,
 * the plan asked for, so the page can start a checkout for it. Stripe stays the authority: this
 * path only ever ends or lowers the row, never grants anything.
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
    .select('id, tier, status, stripe_price_id, ai_mode')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!hasCloudSync(subscription)) return noPaidPlan()

  const currentTierKey: PaidTierKey = subscription!.tier === 'pro_ai' ? 'proAi' : 'pro'
  const tierKey: PaidTierKey = target.tier ?? currentTierKey

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
  // Pro → Pro AI without an option is the managed option, as at checkout.
  const aiMode: AiMode =
    target.aiMode ??
    (currentTierKey === 'proAi'
      ? current?.aiMode ?? (isAiMode(storedMode) ? storedMode : 'managed')
      : 'managed')

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
    // A missing price id in this environment (e.g. the own-key Prices before their env vars are set).
    console.error(`Plan switch: no price configured for ${tierKey} ${interval} ${aiMode}`)
    return NextResponse.json({ error: 'Price not configured', code: CODES.priceUnavailable }, { status: 503 })
  }
  // Every Price of the current tier, both options: the subscription is found whichever one it is on.
  const planPriceIds = getPlanPriceIds(currentTierKey)

  const serviceClient = await createServiceRoleClient()
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()
  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No billing account found', code: CODES.noBillingAccount }, { status: 400 })
  }

  try {
    const returnUrl = absoluteUrl('/account')
    const result = await createPlanSwitchSession({
      customerId: profile.stripe_customer_id,
      targetPriceId,
      planPriceIds,
      returnUrl,
    })
    if (result.kind === 'portal') return NextResponse.json({ url: result.url })
    return NextResponse.json({
      applied: 'end_of_period',
      effectiveAt: new Date(result.effectiveAt * 1000).toISOString(),
      url: returnUrl,
    })
  } catch (err) {
    if (err instanceof PlanSwitchError) {
      if (err.reason === 'no_customer') {
        // Logged without the customer id: one line to find a profile pointing at the wrong account
        // or mode (or a deleted customer).
        console.warn('Plan switch: Stripe has no customer for this account (resource_missing)')
        return NextResponse.json({ error: 'No billing account found', code: CODES.noBillingAccount }, { status: 400 })
      }
      if (err.reason === 'no_entitled_subscription') {
        return correctEndedPlan(serviceClient, subscription!, profile.stripe_customer_id, {
          tier: tierKey,
          interval,
          ...(tierKey === 'proAi' ? { aiMode } : {}),
        })
      }
      if (err.reason === 'already_on_price') {
        const message =
          target.aiMode === undefined && target.tier === undefined
            ? `You're already billed ${interval}.`
            : "You're already on that plan."
        return NextResponse.json({ error: message, code: CODES.alreadyOnPrice }, { status: 409 })
      }
      if (err.reason === 'cancel_scheduled') {
        return NextResponse.json(
          {
            error:
              'Your plan is set to end at the end of this term. Renew it in Manage billing before changing it.',
            code: CODES.cancelScheduled,
          },
          { status: 409 }
        )
      }
      if (err.reason === 'already_scheduled') {
        return NextResponse.json(
          { error: 'A billing change is already scheduled for the end of this term.', code: CODES.alreadyScheduled },
          { status: 409 }
        )
      }
      if (err.reason === 'price_unavailable') {
        console.error(`Plan switch: target price ${targetPriceId} is archived in Stripe`)
        return NextResponse.json({ error: 'Price not available', code: CODES.priceUnavailable }, { status: 503 })
      }
      return noPaidPlan()
    }
    console.error(`Plan switch to ${targetPriceId} failed: ${describeStripeError(err)}`)
    return NextResponse.json({ error: 'Failed to start the plan change', code: CODES.failed }, { status: 500 })
  }
}

/** The 403 for an account with no paid plan to switch. */
function noPaidPlan(checkout?: PlanSwitchCheckoutTarget): NextResponse {
  return NextResponse.json(
    { error: 'No paid plan to switch', code: CODES.noPaidPlan, ...(checkout ? { checkout } : {}) },
    { status: 403 }
  )
}

/** Prefix of the row the signup trigger creates (`free_<user id>`): it tracks no Stripe subscription. */
const SIGNUP_ROW_PREFIX = 'free_'

/**
 * Stripe has no entitled subscription for the customer, yet the account's row shows a paid plan
 * (a missed or failed webhook delivery). Brings the row in line with Stripe through the webhook's
 * own steps (resyncEndedSubscription() in lib/subscriptionSync.ts), logs one line, and answers 403
 * `no_paid_plan` with `checkout`: the plan the user asked for, so the page starts a checkout for it
 * instead of a dead end. `/api/checkout` accepts the account once the row no longer shows an
 * entitled plan, and still refuses anyone whose row does.
 *
 * Nothing is granted here: the row is written only when its own subscription, on this customer,
 * is not entitled at Stripe. When it can't be corrected (no Stripe subscription id on the row,
 * Stripe has no such subscription, it belongs to another customer, or the row moved on to a newer
 * subscription meanwhile) the answer is the plain `no_paid_plan`, and one line says why. A failed
 * Stripe read or database write is a 500 `switch_failed`.
 */
async function correctEndedPlan(
  serviceClient: ServiceRoleClient,
  row: { id?: unknown; tier?: unknown; status?: unknown },
  customerId: string,
  checkout: PlanSwitchCheckoutTarget
): Promise<NextResponse> {
  const subscriptionId = typeof row.id === 'string' ? row.id : ''
  if (!subscriptionId || subscriptionId.startsWith(SIGNUP_ROW_PREFIX)) {
    console.warn('Plan switch: Stripe has no entitled subscription, and the row names no Stripe subscription to correct')
    return noPaidPlan()
  }

  let result
  try {
    result = await resyncEndedSubscription(serviceClient, subscriptionId, customerId)
  } catch (err) {
    console.error(
      err instanceof SubscriptionSyncError ? err.message : `Plan switch resync failed: ${describeStripeError(err)}`
    )
    return NextResponse.json({ error: 'Failed to start the plan change', code: CODES.failed }, { status: 500 })
  }

  if (!result.corrected) {
    console.warn(
      `Plan switch: Stripe has no entitled subscription, but the row was not corrected (subscription ${subscriptionId}, ${result.reason})`
    )
    return noPaidPlan()
  }

  console.warn(
    `Plan switch: corrected a row whose plan had ended at Stripe (subscription ${subscriptionId}: ${String(row.tier)}/${String(row.status)} -> ${result.tier}/${result.status})`
  )
  return noPaidPlan(checkout)
}

/**
 * One log line for a failed Stripe call: the error's type, code, parameter, HTTP status, request id
 * and message. Never the error object itself (its raw response and headers) or anything about the
 * customer beyond what Stripe's message names (price, product or subscription ids).
 */
export function describeStripeError(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err)
  const e = err as {
    type?: unknown
    code?: unknown
    param?: unknown
    statusCode?: unknown
    requestId?: unknown
    message?: unknown
  }
  const parts = [
    typeof e.type === 'string' ? e.type : 'Error',
    typeof e.code === 'string' ? `code ${e.code}` : null,
    typeof e.param === 'string' ? `param ${e.param}` : null,
    typeof e.statusCode === 'number' ? `status ${e.statusCode}` : null,
    typeof e.requestId === 'string' ? `request ${e.requestId}` : null,
  ].filter(Boolean)
  const message = typeof e.message === 'string' ? e.message.slice(0, 300) : ''
  return `${parts.join(', ')}${message ? `: ${message}` : ''}`
}
