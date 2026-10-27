import { classifyPlanChange, type PlanPrice } from './tiers'

/** The plan a subscription is on, or is moving to (a row of the price table in lib/tiers.ts). */
export type PlanPoint = Pick<PlanPrice, 'tierKey' | 'interval' | 'aiMode'>

/**
 * When and how a plan change on an existing subscription happens, per the refund policy
 * (docs/PAYMENTS.md, "Refund policy"): nothing that lowers or shortens a plan applies before the
 * end of the paid period, and no change ever leaves a credit.
 *
 * - `portal`: an upgrade (nothing gets cheaper or shorter, own key → managed included). The customer
 *   confirms it on Stripe's own "confirm plan change" page, which shows the amount and the card,
 *   and it is charged now, prorated against the unused time (`always_invoice`).
 * - `portal_end_of_period`: a change the Billing Portal's confirm page defers to the end of the
 *   period itself (the configuration's `decreasing_item_amount` and `shortening_interval`
 *   conditions; the portal makes a subscription schedule, no proration, no credit):
 *   - only the interval shortens (yearly → monthly) on the same plan and option: one product, the
 *     documented case;
 *   - a downgrade whose interval doesn't shorten: Pro AI → Pro and managed → own key (same
 *     interval, or monthly → yearly), own key → Pro. These cross products. Stripe's documentation
 *     says the portal defers only between prices of one product, but in test mode (2026-10-26, the
 *     real confirm page, test clocks) every one of these was deferred and landed on the target
 *     price at the period end. Because that is undocumented, the webhook raises an alarm when a
 *     plan change lowers a plan at once or leaves a credit (lib/planChangeAlarm.ts).
 * - `end_of_period`: the interval shortens together with another change (e.g. Pro yearly → Pro AI
 *   monthly, Pro AI yearly → Pro monthly), or a price this environment doesn't know. The portal
 *   applied such a change at once with a balance credit in test mode (Pro yearly → Pro AI monthly:
 *   -$35.00), so the server schedules it for the end of the paid period itself, with no proration.
 *
 * The single rule for both sides: `createPlanSwitchSession()` (lib/stripe.ts) acts on it, and the
 * plan-change confirmation (components/pricing/usePlanChange.tsx) describes it before the POST,
 * so what the dialog promises is what the server does. Pure and client-safe.
 */
export type PlanChangeTiming = 'end_of_period' | 'portal_end_of_period' | 'portal'

export function planChangeTiming(from: PlanPoint | null, to: PlanPoint | null): PlanChangeTiming {
  const kind = classifyPlanChange(from, to)
  if (kind === 'upgrade') return 'portal'
  if (kind === 'shorter_interval') return 'portal_end_of_period'
  // A downgrade the portal is known to defer: both prices known, and the interval doesn't shorten.
  if (from && to && !(from.interval === 'yearly' && to.interval === 'monthly')) return 'portal_end_of_period'
  return 'end_of_period'
}
