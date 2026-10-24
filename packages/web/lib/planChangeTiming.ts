import { classifyPlanChange, type PlanPrice } from './tiers'

/** The plan a subscription is on, or is moving to (a row of the price table in lib/tiers.ts). */
export type PlanPoint = Pick<PlanPrice, 'tierKey' | 'interval' | 'aiMode'>

/**
 * When and how a plan change on an existing subscription happens, per the refund policy
 * (docs/PAYMENTS.md, "Refund policy"):
 * - `end_of_period`: a downgrade (Pro AI → Pro, managed → own key, or a shorter interval together
 *   with another change). The server schedules it for the end of the paid period, with no
 *   proration and no refund. The Billing Portal can't: it defers changes only between prices of
 *   one product, and each plan option is its own product.
 * - `portal_end_of_period`: only the interval shortens (yearly → monthly) on the same plan and
 *   option. The portal's confirm page takes it, and the configuration's `shortening_interval`
 *   condition defers it to the end of the term.
 * - `portal`: an upgrade (nothing gets cheaper or shorter). The customer confirms it on Stripe's
 *   own "confirm plan change" page, which shows the amount and the card, and it is charged now,
 *   prorated against the unused time (`always_invoice`).
 *
 * The single rule for both sides: `createPlanSwitchSession()` (lib/stripe.ts) acts on it, and the
 * plan-change confirmation (components/pricing/usePlanChange.tsx) describes it before the POST,
 * so what the dialog promises is what the server does. Pure and client-safe.
 */
export type PlanChangeTiming = 'end_of_period' | 'portal_end_of_period' | 'portal'

export function planChangeTiming(from: PlanPoint | null, to: PlanPoint | null): PlanChangeTiming {
  const kind = classifyPlanChange(from, to)
  if (kind === 'downgrade') return 'end_of_period'
  if (kind === 'shorter_interval') return 'portal_end_of_period'
  return 'portal'
}
