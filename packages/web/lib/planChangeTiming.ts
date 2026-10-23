import { classifyPlanChange, type PlanPrice } from './tiers'

/** The plan a subscription is on, or is moving to (a row of the price table in lib/tiers.ts). */
export type PlanPoint = Pick<PlanPrice, 'tierKey' | 'interval' | 'aiMode'>

/**
 * When and how a plan change on an existing subscription happens, per the refund policy:
 * - `end_of_period`: scheduled for the end of the paid period, no proration, no refund
 *   (downgrades, and a shorter interval on an own-key price);
 * - `portal_end_of_period`: a shorter interval on a price the Billing Portal lists; the portal's
 *   `shortening_interval` condition defers it to the end of the term;
 * - `now`: an upgrade the portal can't offer (own-key prices), applied now and charged prorated;
 * - `portal`: any other upgrade, through the Billing Portal's own confirmation page.
 *
 * The single rule for both sides: `createPlanSwitchSession()` (lib/stripe.ts) acts on it, and the
 * plan-change confirmation (components/pricing/usePlanChange.tsx) describes it before the POST,
 * so what the dialog promises is what the server does. Pure and client-safe.
 *
 * The portal can't list own-key prices (one price per product and interval, and they share the
 * Pro AI product with the managed ones), so any change to or from one is handled directly.
 */
export type PlanChangeTiming = 'end_of_period' | 'portal_end_of_period' | 'now' | 'portal'

export function planChangeTiming(from: PlanPoint | null, to: PlanPoint | null): PlanChangeTiming {
  const kind = classifyPlanChange(from, to)
  const portalCanList = from?.aiMode !== 'byok' && to?.aiMode !== 'byok'
  if (kind === 'downgrade') return 'end_of_period'
  if (kind === 'shorter_interval') return portalCanList ? 'portal_end_of_period' : 'end_of_period'
  return portalCanList ? 'portal' : 'now'
}
