'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { CurrentPlan } from '@/lib/currentPlan'
import { formatDate } from '@/lib/utils'
import { PricingTable } from './PricingTable'
import { useTierName } from './tierFeatures'
import { useVisitorPlan } from './useVisitorPlan'

/**
 * Plan dates as the server formatted them before the plan moved to the browser: in UTC, the
 * time zone the site's functions run in, so a date never shifts by a day with the visitor's.
 */
const PLAN_DATE_TIME_ZONE = 'UTC'

/**
 * The pricing page's cards for this visitor. The plan (with a change already scheduled at Stripe)
 * is read in the browser (`useVisitorPlan`), so the page itself reads no session: until it is
 * known, the paid cards' buttons are same-size skeletons and the badges show as for a guest.
 * Guests and free accounts both come back as `free`; `signedIn` tells them apart.
 */
export function PricingTableForVisitor({ installHref }: { installHref: string }) {
  const plan = useVisitorPlan({ withPendingChange: true })
  return (
    <>
      <PlanStatus plan={plan} />
      <VisitorPricingTable plan={plan} installHref={installHref} />
    </>
  )
}

const TIER_KEYS = { free: 'free', pro: 'pro', pro_ai: 'proAi' } as const

/**
 * One polite live region, in the page from the first render and filled once the plan is known,
 * for signed-in visitors only: the cards' buttons change from skeletons to the account's own
 * choices, and this says why ("Your plan: Pro"). Guests hear nothing: their page doesn't change.
 */
function PlanStatus({ plan }: { plan: CurrentPlan | undefined }) {
  const t = useTranslations('pricing')
  const tierName = useTierName()
  return (
    <p role="status" data-testid="plan-status" className="sr-only">
      {plan?.signedIn ? t('yourPlan', { plan: tierName(TIER_KEYS[plan.tier]) }) : ''}
    </p>
  )
}

function VisitorPricingTable({ plan, installHref }: { plan: CurrentPlan | undefined; installHref: string }) {
  const locale = useLocale()

  if (!plan) return <PricingTable installHref={installHref} planLoading />

  // A plan change already scheduled shows on the cards instead of changes the server would refuse.
  const scheduledChange = plan.pendingChange
    ? { plan: plan.pendingChange.plan, date: formatDate(plan.pendingChange.effectiveAt, locale, PLAN_DATE_TIME_ZONE) }
    : null
  // A plan set to end (cancelled at the period end) is offered no change until it is kept.
  const planEnds = plan.setToEnd
    ? { date: plan.periodEnd ? formatDate(plan.periodEnd, locale, PLAN_DATE_TIME_ZONE) : null }
    : null

  return (
    <PricingTable
      currentTier={plan.tier}
      currentInterval={plan.interval}
      currentAiMode={plan.aiMode}
      currentPeriodEnd={plan.periodEnd}
      installHref={installHref}
      signedIn={plan.signedIn}
      scheduledChange={scheduledChange}
      planEnds={planEnds}
    />
  )
}
