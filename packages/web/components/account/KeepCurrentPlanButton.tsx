'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { KEEP_CURRENT_PLAN_ERROR_CODES, type KeepCurrentPlanErrorCode } from '@/lib/checkoutErrors'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

const CODES: readonly string[] = Object.values(KEEP_CURRENT_PLAN_ERROR_CODES)
const isKeepPlanErrorCode = (code: unknown): code is KeepCurrentPlanErrorCode =>
  typeof code === 'string' && CODES.includes(code)

/**
 * "Keep my current plan" next to a scheduled plan change: POSTs to `/api/billing/keep-current-plan`,
 * which releases the change's subscription schedule at Stripe (no charge, no credit), then reports
 * success through `onKept` and refreshes the page, so the notice goes away and the Billing Portal
 * offers cancellation again. Disabled while the request runs; an error is shown under the button,
 * per code. Taking the action is the confirmation: nothing is charged and the plan doesn't change,
 * so there is no dialog.
 */
export function KeepCurrentPlanButton({ onKept }: { onKept?: () => void }) {
  const t = useTranslations('account.keepCurrentPlan')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/keep-current-plan', { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { ok?: unknown; code?: unknown } | null
      if (res.ok && data?.ok === true) {
        onKept?.()
        router.refresh()
        return
      }
      const code = isKeepPlanErrorCode(data?.code) ? data.code : KEEP_CURRENT_PLAN_ERROR_CODES.failed
      setError(t(`errors.${code}`, { email: SUPPORT_EMAIL }))
    } catch {
      setError(t(`errors.${KEEP_CURRENT_PLAN_ERROR_CODES.failed}`, { email: SUPPORT_EMAIL }))
    }
    setLoading(false)
  }

  return (
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
  )
}
