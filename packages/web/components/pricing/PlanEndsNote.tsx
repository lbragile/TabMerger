'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * A paid plan set to end (cancelled at the period end), as the plan-change entry points pass it:
 * `date` is the period end, formatted on the server for the page's locale (client formatting of an
 * SSR'd date can differ by time zone and break hydration); null when it isn't known.
 */
export interface PlanEnds {
  date: string | null
}

/**
 * What a plan-change button becomes while the plan is set to end: "Your plan ends on {date}. Keep
 * your plan to change it.", the link going to the account page, where "Keep my plan" undoes the
 * cancellation. The server refuses any change until then (409 `cancel_scheduled`), so no button is
 * offered. Used by the pricing cards and the Pro AI option switch on the dashboard.
 */
export function PlanEndsNote({ ends, className, testId }: { ends: PlanEnds; className?: string; testId?: string }) {
  const t = useTranslations('pricing.planEnds')
  const link = (chunks: React.ReactNode) => (
    <Link href="/account" className="text-primary underline underline-offset-2">
      {chunks}
    </Link>
  )
  return (
    <p data-testid={testId} className={className}>
      {ends.date ? t.rich('note', { date: ends.date, link }) : t.rich('noteNoDate', { link })}
    </p>
  )
}
