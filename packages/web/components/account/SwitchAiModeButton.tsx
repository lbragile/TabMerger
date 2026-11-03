'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { AiMode } from '@tabmerger/shared'
import { isAiOptionAvailable, otherAiMode } from '@/components/pricing/aiOptions'
import { usePlanChange } from '@/components/pricing/usePlanChange'
import { PlanEndsNote, type PlanEnds } from '@/components/pricing/PlanEndsNote'
import type { BillingInterval } from '@/lib/tiers'
import { cn } from '@/lib/utils'

interface SwitchAiModeButtonProps {
  /** The Pro AI subscription's setup option now. The button offers the other one. */
  current: AiMode
  /** How the subscription is billed (from its price); unknown leaves "billed monthly/yearly" out of the result message. */
  interval?: BillingInterval
  /** `subscriptions.current_period_end`, the date a scheduled change takes effect. */
  periodEnd?: string | null
  /** Where sign-in returns to if the session has expired. */
  returnPath: string
  /**
   * The plan is set to end (cancelled at the period end): a note saying when, linking to the
   * account page where it can be kept, replaces the button. The server refuses the switch until
   * then (409 `cancel_scheduled`).
   */
  planEnds?: PlanEnds | null
  className?: string
}

/**
 * "Handle setup yourself" / "Let TabMerger handle setup" for a Pro AI subscriber: the same
 * subscription and interval, the other option's price, through `/api/billing/switch-plan` (see
 * `usePlanChange`). Both go straight to Stripe's own "confirm plan change" page, with no dialog of
 * ours. Moving to "TabMerger" is an upgrade, charged now, prorated. Moving to "You" is a
 * downgrade: Stripe's page shows "Updates on {date}" and schedules it for the period's end, with
 * no credit; managed AI lasts until that date. Only when the subscription's price isn't one this
 * deployment sells (interval unknown) does the server schedule the change itself, so our dialog
 * confirms it first. Renders nothing while the other option isn't on sale, and a note instead of
 * the button while the plan is set to end (`planEnds`).
 */
export function SwitchAiModeButton({ current, interval, periodEnd, returnPath, planEnds, className }: SwitchAiModeButtonProps) {
  const t = useTranslations('pricing.aiOptions')
  const target = otherAiMode(current)
  const change = usePlanChange({ tierKey: 'proAi', interval, aiMode: current, periodEnd, setToEnd: !!planEnds }, returnPath)
  if (!isAiOptionAvailable(target)) return null
  if (planEnds) return <PlanEndsNote ends={planEnds} testId="switch-ai-mode-plan-ends" className={cn('text-text2', className)} />

  return (
    <span className={cn('inline-flex flex-col items-start gap-1', className)}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        onClick={() => change.start({ aiMode: target })}
        disabled={change.loading}
      >
        {change.loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
        {target === 'byok' ? t('switchToByok') : t('switchToManaged')}
      </button>
      <span role="status" className={cn('text-text2', !change.done && 'sr-only')}>
        {change.done}
      </span>
      {change.error && (
        <span role="alert" className="text-destructive">
          {change.error}
        </span>
      )}
      {change.dialog}
    </span>
  )
}
