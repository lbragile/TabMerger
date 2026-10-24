import { isAiMode, type AiMode } from '@tabmerger/shared'
import type { BillingInterval, PaidTierKey } from './tiers'

/**
 * Error codes `POST /api/checkout` returns in `{ error }` that the pricing UI acts on.
 * Client-safe (no server imports): the route and `PricingCard` both read the code from here.
 */

/**
 * 409: the account already has a paid plan, in the database or at Stripe. An account holds one
 * subscription, so no Checkout Session is created; a plan change goes through the plan switch or
 * the Billing Portal. With `recorded: true` the account's row now shows that plan (it did already,
 * or the server just wrote it from Stripe), so the page refreshes to show it; without it the plan
 * can't be shown here (a price this deployment doesn't sell) and the page opens the portal.
 */
export const ALREADY_SUBSCRIBED_ERROR = 'already_subscribed'

/**
 * Thrown by createCheckoutSession() (lib/stripe.ts) when another subscription checkout of the
 * customer completed while the new one was being opened: the new session has been expired and no
 * URL is handed out. The route answers 409 `already_subscribed` (`recorded: false`: the
 * completed session's webhook records the plan). Lives here, with no server imports, so a route
 * test that mocks lib/stripe.ts still has the class.
 */
export class CheckoutRaceLostError extends Error {
  constructor(readonly completedSessionId: string) {
    super(`Checkout session ${completedSessionId} completed while a new one was opened`)
    this.name = 'CheckoutRaceLostError'
  }
}

/**
 * 409: no live plan, but one at Stripe that can still be paid or resumed (unpaid, paused,
 * incomplete). Paying it would make it live next to a new one, so no checkout is sold; the
 * customer pays or resumes it in Manage billing. Same code as the plan switch's.
 */
export const PAY_OR_RESUME_ERROR = 'pay_or_resume'

/**
 * 503: the customer's subscriptions couldn't be read from Stripe, so nothing is sold (fail closed).
 * Logged on the server; the customer can try again.
 */
export const BILLING_CHECK_FAILED_ERROR = 'billing_check_failed'

/**
 * Codes `POST /api/billing/switch-plan` and `/api/billing/switch-interval` return in `{ code }`
 * (next to an English `error`), so the pricing page can say what went wrong in the user's
 * language. Client-safe, shared by lib/planSwitch.ts and components/pricing/usePlanChange.tsx.
 */
export const PLAN_SWITCH_ERROR_CODES = {
  /** 400: the account has no Stripe customer yet. */
  noBillingAccount: 'no_billing_account',
  /** 403: no entitled paid plan, in the database or at Stripe. */
  noPaidPlan: 'no_paid_plan',
  /** 409: the subscription is already on the target price. */
  alreadyOnPrice: 'already_on_price',
  /** 409: a change is already scheduled for the end of the term (a subscription schedule). */
  alreadyScheduled: 'already_scheduled',
  /**
   * 409: no live plan, but one that can still be paid or resumed (unpaid, paused, incomplete). The
   * customer pays or resumes it in Manage billing; no checkout is offered (it would be a second plan).
   */
  payOrResume: PAY_OR_RESUME_ERROR,
  /** 409: the subscription is set to end; it is renewed in the portal first. */
  cancelScheduled: 'cancel_scheduled',
  /** 503: the target price isn't configured here, or Stripe has it archived. */
  priceUnavailable: 'price_unavailable',
  /** 500: Stripe refused or failed; the details are in the server log. */
  failed: 'switch_failed',
} as const

export type PlanSwitchErrorCode = (typeof PLAN_SWITCH_ERROR_CODES)[keyof typeof PLAN_SWITCH_ERROR_CODES]

/**
 * The plan to subscribe to instead, sent as `checkout` next to a 403 `no_paid_plan` from the
 * plan-switch routes in one case only: the account's row still showed a paid plan, Stripe said
 * that plan had ended (a missed webhook delivery), and the server has just corrected the row. The
 * pricing page then starts a checkout for it (`POST /api/checkout`, which checks everything again)
 * instead of showing a dead end. It is the plan the user asked to switch to, all fields filled in.
 */
export interface PlanSwitchCheckoutTarget {
  tier: PaidTierKey
  interval: BillingInterval
  /** Pro AI only. */
  aiMode?: AiMode
}

/** Reads a `checkout` value from a plan-switch response; null unless it is a valid target. */
export function parsePlanSwitchCheckoutTarget(value: unknown): PlanSwitchCheckoutTarget | null {
  if (!value || typeof value !== 'object') return null
  const { tier, interval, aiMode } = value as Record<string, unknown>
  if (tier !== 'pro' && tier !== 'proAi') return null
  if (interval !== 'monthly' && interval !== 'yearly') return null
  if (tier === 'pro') return aiMode === undefined ? { tier, interval } : null
  if (aiMode === undefined) return { tier, interval }
  return isAiMode(aiMode) ? { tier, interval, aiMode } : null
}
