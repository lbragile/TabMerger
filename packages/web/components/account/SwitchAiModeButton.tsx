'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { AiMode } from '@tabmerger/shared'
import { isAiOptionAvailable, otherAiMode } from '@/components/pricing/aiOptions'
import { usePlanChange } from '@/components/pricing/usePlanChange'
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
  className?: string
}

/**
 * "Handle setup yourself" / "Let TabMerger handle setup" for a Pro AI subscriber: the same
 * subscription and interval, the other option's price, through `/api/billing/switch-plan` (see
 * `usePlanChange`). Moving to "TabMerger" is an upgrade: Stripe's own "confirm plan change" page,
 * charged now, prorated. Moving to "You" is a downgrade: our dialog says it changes on the
 * period's end date, then Stripe's confirm page schedules it for then, with no credit; managed AI
 * lasts until that date. Renders nothing while the other option isn't on sale.
 */
export function SwitchAiModeButton({ current, interval, periodEnd, returnPath, className }: SwitchAiModeButtonProps) {
  const t = useTranslations('pricing.aiOptions')
  const target = otherAiMode(current)
  const change = usePlanChange({ tierKey: 'proAi', interval, aiMode: current, periodEnd }, returnPath)
  if (!isAiOptionAvailable(target)) return null

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
