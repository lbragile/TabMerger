'use client'

import { useEffect } from 'react'
import type { PostHog, PostHogConfig } from 'posthog-js'
import { deleteCookies, getEffectiveConsent, subscribeConsent, type ConsentChoice } from '@/lib/consent'
import { REPLAY_BLOCK_SELECTOR, scrubPostHogEvent } from '@/lib/analyticsPrivacy'

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
 * PostHog's settings for a visitor's choice. It only ever starts once analytics are allowed (see
 * `applyPostHogConsent`), so in practice this is the Accept configuration: persistent identifiers
 * and session recording. The memory-only, no-recording variant is what a running instance falls
 * back to after Reject. `persistence: 'memory'` rather than `cookieless_mode`, which also needs a
 * setting in the PostHog project.
 *
 * Whatever the choice, nothing private reaches PostHog (lib/analyticsPrivacy.ts): every input is
 * masked, popups and `ph-no-capture` containers (dashboard, account, shared tabs, the account
 * email) are blocked from replay, URL fragments (a share link's `#key=`) are stripped, and click
 * events on the private pages are dropped.
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
    // Strips `#…` from $current_url, $initial_current_url, $session_entry_url, autocaptured hrefs
    // and replay's page URLs; `before_send` catches any other URL-valued property.
    disable_capture_url_hashes: true,
    before_send: scrubPostHogEvent,
    session_recording: {
      // Keep PostHog's default masking: this app has auth/billing pages, do not relax it.
      maskAllInputs: true,
      blockSelector: REPLAY_BLOCK_SELECTOR,
    },
  }
}

/**
 * Applies the visitor's effective cookie choice (`getEffectiveConsent`) to PostHog.
 * - Accept (or an opt-out region): initialize it with persistent identifiers and session
 *   recording, opting back in after an earlier Reject.
 * - No choice yet (opt-in region) or Reject: no PostHog at all, not even initialized; a running
 *   instance stops capturing and recording for the rest of the visit and deletes what it stored.
 */
export function applyPostHogConsent(posthog: PostHog, key: string, choice: ConsentChoice | null): void {
  if (!posthog.__loaded) {
    if (choice !== 'granted') {
      clearPostHogStorage()
      return
    }
    posthog.init(key, postHogConfig(choice))
    posthog.register({ environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development' })
    // A Reject on an earlier visit left PostHog's own opt-out flag behind.
    if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing({ captureEventName: false })
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
 * Starts PostHog (product analytics and session replay) once analytics are allowed (lib/consent.ts),
 * and follows every later change made in the banner. Renders nothing.
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
      applied = getEffectiveConsent()
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
      if (getEffectiveConsent() !== applied) apply()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return null
}
