'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CancelSubscriptionButton } from '@/components/account/CancelSubscriptionButton'
import { KeepCurrentPlanButton, type KeptPlanRenewal } from '@/components/account/KeepCurrentPlanButton'
import { formatCurrency, formatDate } from '@/lib/utils'

/**
 * The account page's scheduled plan change: what changes and when (`notice`, worded on the server),
 * with "Keep my current plan" (undo it here) and "Cancel subscription" (Stripe's cancel page; the
 * Billing Portal's home offers no cancellation while a change is pending).
 *
 * The page renders this for every paid account, with `notice: null` when nothing is scheduled, so
 * it stays mounted across the `router.refresh()` that follows "Keep my current plan": the notice
 * goes away and "Your plan stays {plan}. It renews on {date} for {amount}." takes its place
 * (focused, so keyboard and screen-reader users aren't left on a button that no longer exists).
 * The date and amount come from the route (Stripe's preview of the next invoice, so discounts and
 * tax are in it), formatted for the page's locale; without an amount only the date is given, and
 * without a renewal (the plan is set to end) only that the plan stays. With nothing scheduled and nothing kept it
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
  const locale = useLocale()
  const [kept, setKept] = useState(false)
  const [renewal, setRenewal] = useState<KeptPlanRenewal | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (kept) statusRef.current?.focus()
  }, [kept])

  function keptMessage(): string {
    if (!renewal) return currentPlan ? t('success', { plan: currentPlan }) : t('successUnknownPlan')
    const date = formatDate(renewal.at, locale)
    if (renewal.amount !== undefined && renewal.currency) {
      const amount = formatCurrency(renewal.amount, renewal.currency, locale)
      return currentPlan
        ? t('successRenews', { plan: currentPlan, date, amount })
        : t('successUnknownPlanRenews', { date, amount })
    }
    return currentPlan ? t('successRenewsOn', { plan: currentPlan, date }) : t('successUnknownPlanRenewsOn', { date })
  }

  if (kept) {
    return (
      <p ref={statusRef} role="status" tabIndex={-1} className="text-sm font-medium outline-none">
        {keptMessage()}
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
        <KeepCurrentPlanButton
          onKept={(next) => {
            setRenewal(next)
            setKept(true)
          }}
        />
        <CancelSubscriptionButton />
      </div>
    </div>
  )
}
