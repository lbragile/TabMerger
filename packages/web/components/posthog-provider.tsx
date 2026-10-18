'use client'

import { useEffect } from 'react'
import type { PostHog, PostHogConfig } from 'posthog-js'
import { deleteCookies, getConsentChoice, subscribeConsent, type ConsentChoice } from '@/lib/consent'

/** Where PostHog keeps its identifiers once the visitor accepts cookies (its default). */
const CONSENTED_PERSISTENCE = 'localStorage+cookie' as const

/**
 * PostHog's identifiers: the `ph_<project key>_posthog` cookie and storage entries, and the
 * per-tab window ID in session storage. Its `__ph_opt_in_out_<key>` flag is left alone: it only
 * records a Reject, and removing it would let a running instance capture again.
 */
const POSTHOG_STORAGE_KEY = /^ph_.+_(posthog|window_id|primary_window_exists)$/

/**
 * Removes PostHog's identifiers: from an earlier visit (before consent existed), or from earlier
 * in this one after a change to Reject (the session-storage copies outlive `disable_persistence`).
 */
function clearPostHogStorage() {
  deleteCookies(POSTHOG_STORAGE_KEY)
  try {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of Object.keys(storage)) if (POSTHOG_STORAGE_KEY.test(key)) storage.removeItem(key)
    }
  } catch {
    // Storage blocked: then nothing was stored either.
  }
}

/**
 * PostHog's settings for a visitor's choice. Without consent it keeps its identifiers in memory
 * only (gone with the page: no cookie, no local storage) and records no sessions; after Accept it
 * persists them and records sessions, with every input masked. `persistence: 'memory'` rather than
 * `cookieless_mode`, which also needs a setting in the PostHog project.
 */
export function postHogConfig(choice: ConsentChoice | null): Partial<PostHogConfig> {
  const granted = choice === 'granted'
  return {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    // Surveys are not used; their script is ~100 KB of dead weight on every page.
    disable_surveys: true,
    persistence: granted ? CONSENTED_PERSISTENCE : 'memory',
    disable_session_recording: !granted,
    session_recording: {
      // Keep PostHog's default masking: this app has auth/billing pages, do not relax it.
      maskAllInputs: true,
    },
  }
}

/**
 * Applies a visitor's cookie choice to PostHog, initializing it on first use.
 * - No choice yet: capture with in-memory identifiers, no recording.
 * - Accept: persistent identifiers and session recording, opting back in after an earlier Reject.
 * - Reject: no PostHog at all; a running instance stops capturing and recording for the rest of
 *   the visit and deletes what it stored.
 */
export function applyPostHogConsent(posthog: PostHog, key: string, choice: ConsentChoice | null): void {
  if (!posthog.__loaded) {
    if (choice !== 'granted') clearPostHogStorage()
    if (choice === 'denied') return
    posthog.init(key, postHogConfig(choice))
    posthog.register({ environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development' })
    // A Reject on an earlier visit left PostHog's own opt-out flag behind.
    if (choice === 'granted' && posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false })
    return
  }

  if (choice === 'granted') {
    posthog.set_config({ persistence: CONSENTED_PERSISTENCE, disable_persistence: false })
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false })
    posthog.startSessionRecording()
    return
  }

  posthog.stopSessionRecording()
  if (choice === 'denied') posthog.opt_out_capturing()
  posthog.set_config({ persistence: 'memory', disable_persistence: true })
  clearPostHogStorage()
}

/**
 * Starts PostHog (product analytics and session replay) according to the visitor's cookie
 * choice, and follows every later change made in the banner. Renders nothing.
 *
 * Separate concern from Sentry Replay (crash-context video only). No-ops if
 * NEXT_PUBLIC_POSTHOG_KEY isn't set, same as trackEvent() in lib/analytics.ts for GA4.
 */
export function PostHogProvider() {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (!key) return

    let cancelled = false
    let posthog: PostHog | undefined
    let applied: ConsentChoice | null = null
    const apply = () => {
      if (!posthog) return
      applied = getConsentChoice()
      applyPostHogConsent(posthog, key, applied)
    }

    // Imported on demand: the library is not part of the page's own bundle, so it costs the
    // first load nothing.
    void import('posthog-js').then(({ default: instance }) => {
      if (cancelled) return
      posthog = instance
      apply()
    })
    const unsubscribe = subscribeConsent(() => {
      // Subscribers also hear the banner opening; only a changed choice is news to PostHog.
      if (getConsentChoice() !== applied) apply()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return null
}
