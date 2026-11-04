'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CANCEL_SUBSCRIPTION_ERROR_CODES } from '@/lib/checkoutErrors'
import { SUPPORT_EMAIL } from '@/lib/supportInbox'

const CODES: readonly string[] = Object.values(CANCEL_SUBSCRIPTION_ERROR_CODES)
const isCancelErrorCode = (code: unknown): code is (typeof CANCEL_SUBSCRIPTION_ERROR_CODES)[keyof typeof CANCEL_SUBSCRIPTION_ERROR_CODES] =>
  typeof code === 'string' && CODES.includes(code)

/**
 * "Cancel subscription" while a plan change is scheduled (the Billing Portal's home page offers no
 * cancellation then). Asks `/api/billing/cancel-subscription` for Stripe's own "cancel plan" page
 * and goes there; Stripe's page is the confirmation step, so there is no dialog of our own.
 * Confirming there releases the scheduled change and ends the current plan at the end of the paid
 * period, with no refund. An error is shown under the button, per code.
 */
export function CancelSubscriptionButton() {
  const t = useTranslations('account.cancelSubscription')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/cancel-subscription', { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { url?: unknown; code?: unknown } | null
      if (res.ok && typeof data?.url === 'string') {
        window.location.href = data.url
        return
      }
      const code = isCancelErrorCode(data?.code) ? data.code : CANCEL_SUBSCRIPTION_ERROR_CODES.failed
      setError(t(`errors.${code}`, { email: SUPPORT_EMAIL }))
    } catch {
      setError(t(`errors.${CANCEL_SUBSCRIPTION_ERROR_CODES.failed}`, { email: SUPPORT_EMAIL }))
    }
    setLoading(false)
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={loading}
        className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
      >
        {loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
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
