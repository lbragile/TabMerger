'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CancelSubscriptionButton } from '@/components/account/CancelSubscriptionButton'
import { KeepCurrentPlanButton } from '@/components/account/KeepCurrentPlanButton'

/**
 * The account page's scheduled plan change: what changes and when (`notice`, worded on the server),
 * with "Keep my current plan" (undo it here) and "Cancel subscription" (Stripe's cancel page; the
 * Billing Portal's home offers no cancellation while a change is pending).
 *
 * The page renders this for every paid account, with `notice: null` when nothing is scheduled, so
 * it stays mounted across the `router.refresh()` that follows "Keep my current plan": the notice
 * goes away and "Your plan stays {plan}." takes its place (focused, so keyboard and screen-reader
 * users aren't left on a button that no longer exists). With nothing scheduled and nothing kept it
 * renders nothing.
 */
export function ScheduledChangeNotice({
  notice,
  currentPlan,
}: {
  notice: { message: string; note: string } | null
  /** The current plan's name ("Pro AI, billed monthly"), or null for a price this deployment doesn't sell. */
  currentPlan: string | null
}) {
  const t = useTranslations('account.keepCurrentPlan')
  const [kept, setKept] = useState(false)
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (kept) statusRef.current?.focus()
  }, [kept])

  if (kept) {
    return (
      <p ref={statusRef} role="status" tabIndex={-1} className="text-sm font-medium outline-none">
        {currentPlan ? t('success', { plan: currentPlan }) : t('successUnknownPlan')}
      </p>
    )
  }
  if (!notice) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{notice.message}</p>
        <p className="text-xs text-muted-foreground">{notice.note}</p>
      </div>
      <div className="flex flex-wrap items-start justify-end gap-2">
        <KeepCurrentPlanButton onKept={() => setKept(true)} />
        <CancelSubscriptionButton />
      </div>
    </div>
  )
}
