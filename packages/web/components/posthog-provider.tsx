'use client'

import { useEffect } from 'react'
import posthog from 'posthog-js'

/**
 * Initializes PostHog session replay + autocapture on the client.
 *
 * Separate concern from Sentry Replay (crash-context video only) — this is
 * general behavioral analytics (onboarding/checkout funnels, session replay).
 * No-ops gracefully if NEXT_PUBLIC_POSTHOG_KEY isn't set, same pattern as
 * trackEvent() in lib/analytics.ts for GA4.
 */
export function PostHogProvider() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key || posthog.__loaded) return

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      person_profiles: 'identified_only',
      capture_pageview: true,
      session_recording: {
        // ponytail: keep PostHog's default masking (masks text/inputs unless
        // explicitly opted out) — this app has auth/billing pages, do not
        // relax it. Same concern as the parallel Sentry Replay work.
        maskAllInputs: true,
      },
    })
  }, [])

  return null
}
