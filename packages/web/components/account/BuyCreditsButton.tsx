'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { CREDITS_NOT_AVAILABLE_ERROR, RATE_LIMITED_ERROR } from '@/lib/checkoutErrors'

/**
 * Plain "Get more" CTA — starts a Stripe Checkout session at the default
 * quantity (50 calls, the server-side minimum) and redirects immediately.
 * Stripe's own Checkout page has adjustable_quantity enabled (50-500), so
 * the customer can change the amount there instead of us building and
 * maintaining our own quantity picker here.
 *
 * A 403 `credits_not_available` (no paid-up managed Pro AI plan, e.g. a page opened before the plan
 * ended) says who packs are for; a 429 `rate_limited` asks to wait a few minutes; any other failure
 * says checkout couldn't start.
 */
export function BuyCreditsButton() {
  const [loading, setLoading] = useState(false)
  const t = useTranslations('account.credits')

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout/credits', { method: 'POST' })
      const data = await res.json()
      if (res.status === 403 && data?.error === CREDITS_NOT_AVAILABLE_ERROR) {
        toast.error(t('notAvailable'))
        setLoading(false)
        return
      }
      if (res.status === 429 && data?.error === RATE_LIMITED_ERROR) {
        toast.error(t('rateLimited'))
        setLoading(false)
        return
      }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? 'No checkout URL')
      }
      window.location.href = data.url
    } catch {
      toast.error(t('failed'))
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      onClick={handleClick}
      disabled={loading}
    >
      {loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
      {t('getMore')}
    </button>
  )
}
