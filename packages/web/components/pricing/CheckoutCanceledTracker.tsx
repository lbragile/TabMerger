'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  parseCanceledCheckout,
  trackCheckoutCanceled,
  withoutCheckoutReturnParams,
} from '@/lib/checkoutAnalytics'

/**
 * Runs on the pricing page. When Stripe sends a buyer back through the checkout's `cancel_url`
 * (`?checkout=canceled&tier=…&interval=…`, see checkoutCancelPath()), it sends one
 * `checkout_canceled` event, says no charge was made, then removes those parameters from the
 * address bar, so a refresh or a shared link doesn't count it again. Renders nothing.
 *
 * The URL is rewritten with `window.history.replaceState`, not `router.replace`: this effect runs
 * on mount, and a child's mount effect runs before the App Router has initialized, so a router
 * call there can throw "Router action dispatched before initialization". Next keeps
 * `usePathname`/`useSearchParams` in sync with native history calls, and nothing on the server
 * needs to re-render just to drop a query parameter (the same approach as `UpgradedBanner`).
 *
 * Uses `next/navigation`'s `usePathname` (not the locale-aware one): it is the real path, locale
 * prefix included, which is exactly what the rewritten URL must keep.
 */
export function CheckoutCanceledTracker() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const t = useTranslations('pricing')
  // Survives React's development double-run of effects, which would otherwise fire twice.
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    const canceled = parseCanceledCheckout(searchParams)
    if (!canceled) return
    handled.current = true

    trackCheckoutCanceled(canceled)
    toast.info(t('checkoutCanceled'))

    const rest = withoutCheckoutReturnParams(new URLSearchParams(searchParams.toString()))
    window.history.replaceState(null, '', `${pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
  }, [searchParams, pathname, t])

  return null
}
