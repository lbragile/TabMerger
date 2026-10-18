'use client'

import { useEffect } from 'react'
import { getConsentChoice, subscribeConsent } from '@/lib/consent'
import { loadGoogleAnalytics, updateGoogleAnalyticsConsent } from '@/lib/analytics'

/**
 * Loads Google Analytics with the visitor's stored cookie choice applied before its first hit,
 * and passes on every later change made in the banner. Renders nothing.
 */
export function ConsentedGoogleAnalytics({ gaId }: { gaId: string }) {
  useEffect(() => {
    let applied = getConsentChoice()
    if (!loadGoogleAnalytics(gaId, applied)) return
    return subscribeConsent(() => {
      // Subscribers also hear the banner opening; only a changed choice is news to GA.
      const choice = getConsentChoice()
      if (choice === applied) return
      applied = choice
      updateGoogleAnalyticsConsent(choice)
    })
  }, [gaId])

  return null
}
