'use client'

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { stripUrlFragment } from '@/lib/analyticsPrivacy'

/**
 * Vercel Web Analytics reads `location.href` itself and reports it (the beacon's `o` field), so on
 * a shared link it would send the `#key=…` decryption key. `beforeSend` is its supported hook for
 * rewriting that URL; Speed Insights gets the same treatment. A client component because a
 * function can't be passed as a prop from the (server) root layout.
 */
export function vercelBeforeSend<T extends { url: string }>(event: T): T {
  return { ...event, url: stripUrlFragment(event.url) }
}

export function VercelInsights() {
  return (
    <>
      <Analytics beforeSend={vercelBeforeSend<BeforeSendEvent>} />
      <SpeedInsights beforeSend={vercelBeforeSend} />
    </>
  )
}
