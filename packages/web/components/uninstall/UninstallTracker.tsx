'use client'

import { useEffect, useRef } from 'react'
import { recordUninstall } from '@/app/[locale]/(marketing)/uninstalled/actions'

/** sessionStorage key marking that this tab already recorded the uninstall for this URL. */
export const UNINSTALL_TRACKED_KEY = 'tm_uninstall_tracked'

interface UninstallTrackerProps {
  version?: string
  browser?: string
  channel?: string
  analytics?: boolean
}

/**
 * Asks the server to record `extension_uninstalled` once per page view. Renders nothing.
 *
 * Once only: a ref covers React's double effect run in development, and a sessionStorage flag
 * (scoped to the query string) covers a refresh or a back/forward visit in the same tab. GA4 does
 * not deduplicate Measurement Protocol events, so the guard has to live here. When sessionStorage
 * is unavailable (some private modes), it still sends once per load.
 *
 * Server-side rather than gtag, so an ad blocker can't drop it; the server decides whether the
 * install consented to analytics (`a` flag) and re-checks every value.
 */
export function UninstallTracker({ version, browser, channel, analytics }: UninstallTrackerProps) {
  const sent = useRef(false)

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const key = `${UNINSTALL_TRACKED_KEY}:${globalThis.location?.search ?? ''}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // No sessionStorage: send anyway, the ref still stops a second send in this load.
    }
    void recordUninstall({
      version,
      browser,
      channel,
      analytics: analytics === undefined ? undefined : analytics ? '1' : '0',
    }).catch(() => {})
  }, [version, browser, channel, analytics])

  return null
}
