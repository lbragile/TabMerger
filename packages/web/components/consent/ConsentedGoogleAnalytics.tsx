'use client'

import { useEffect } from 'react'
import { getEffectiveConsent, subscribeConsent } from '@/lib/consent'
import { loadGoogleAnalytics, updateGoogleAnalyticsConsent } from '@/lib/analytics'
import { isAutomatedTestEnvironment } from '@/lib/isAutomatedTestEnvironment'

/**
 * Loads Google Analytics once analytics are allowed (an Accept, or an opt-out region with no
 * Reject and no Global Privacy Control; see `getEffectiveConsent`), and passes on every later
 * change made in the banner. Before that no gtag.js loads at all. Renders nothing.
 *
 * Never loads during an automated test run (see `isAutomatedTestEnvironment`), regardless of
 * consent: e2e's authenticated storage state grants consent so other specs don't see the banner,
 * which would otherwise make this load the real gtag.js script against Google's servers.
 */
export function ConsentedGoogleAnalytics({ gaId }: { gaId: string }) {
  useEffect(() => {
    if (isAutomatedTestEnvironment()) return
    let applied = getEffectiveConsent()
    let loaded = applied === 'granted' && loadGoogleAnalytics(gaId, applied)
    return subscribeConsent(() => {
      // Subscribers also hear the banner opening; only a changed choice is news to GA.
      const choice = getEffectiveConsent()
      if (choice === applied) return
      applied = choice
      if (loaded) updateGoogleAnalyticsConsent(choice, gaId)
      else if (choice === 'granted') loaded = loadGoogleAnalytics(gaId, choice)
    })
  }, [gaId])

  return null
}
