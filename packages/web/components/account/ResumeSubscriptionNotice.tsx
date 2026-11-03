'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { parseKeptPlanRenewal, type KeptPlanRenewal } from '@/components/account/KeepCurrentPlanButton'
import { RESUME_SUBSCRIPTION_ERROR_CODES, type ResumeSubscriptionErrorCode } from '@/lib/checkoutErrors'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'
import { formatCurrency, formatDate } from '@/lib/utils'

const CODES: readonly string[] = Object.values(RESUME_SUBSCRIPTION_ERROR_CODES)
const isResumeErrorCode = (code: unknown): code is ResumeSubscriptionErrorCode =>
  typeof code === 'string' && CODES.includes(code)

/**
 * The account page's cancelled plan: "Your plan ends on {date}." (`notice`, worded on the server)
 * with "Keep my plan", which POSTs to `/api/billing/resume-subscription` (the cancellation is
 * cleared at Stripe, nothing is charged now) and refreshes the page.
 *
 * The page renders this for every paid account, with `notice: null` when the plan isn't set to end,
 * so it stays mounted across the `router.refresh()` that follows: the notice goes away (once the
 * webhook has recorded the change) and "Your plan will renew on {date} for {amount}." takes its
 * place, focused, so keyboard and screen-reader users aren't left on a button that no longer
 * exists. The date and amount come from the route (Stripe's preview of the next invoice), formatted
 * for the page's locale. Taking the action is the confirmation: nothing is charged now and the plan
 * doesn't change, so there is no dialog. An error shows under the button, per code; `not_canceling`
 * (an earlier click, or another tab, already kept it) also refreshes the page.
 */
export function ResumeSubscriptionNotice({ notice }: { notice: { message: string; note: string } | null }) {
  const t = useTranslations('account.resumeSubscription')
  const locale = useLocale()
  const router = useRouter()
  const [kept, setKept] = useState(false)
  const [renewal, setRenewal] = useState<KeptPlanRenewal | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (kept) statusRef.current?.focus()
  }, [kept])

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/resume-subscription', { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { ok?: unknown; code?: unknown; renewal?: unknown } | null
      if (res.ok && data?.ok === true) {
        setRenewal(parseKeptPlanRenewal(data.renewal))
        setKept(true)
        router.refresh()
        return
      }
      const code = isResumeErrorCode(data?.code) ? data.code : RESUME_SUBSCRIPTION_ERROR_CODES.failed
      setError(t(`errors.${code}`, { email: SUPPORT_EMAIL }))
      if (code === RESUME_SUBSCRIPTION_ERROR_CODES.notCanceling || code === RESUME_SUBSCRIPTION_ERROR_CODES.notEntitled) {
        router.refresh()
      }
    } catch {
      setError(t(`errors.${RESUME_SUBSCRIPTION_ERROR_CODES.failed}`, { email: SUPPORT_EMAIL }))
    }
    setLoading(false)
  }

  function keptMessage(): string {
    if (!renewal) return t('success')
    const date = formatDate(renewal.at, locale)
    if (renewal.amount !== undefined && renewal.currency) {
      return t('successRenews', { date, amount: formatCurrency(renewal.amount, renewal.currency, locale) })
    }
    return t('successRenewsOn', { date })
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
      <span className="inline-flex flex-col items-end gap-1">
        <Button type="button" size="sm" onClick={handleClick} loading={loading}>
          {t('button')}
        </Button>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </span>
    </div>
  )
}
