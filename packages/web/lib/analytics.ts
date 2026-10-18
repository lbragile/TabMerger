import { deleteCookies, type ConsentChoice } from '@/lib/consent'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

/** The `id` of the gtag.js `<script>`, so it is only ever added once. */
export const GTAG_SCRIPT_ID = 'tm-gtag'

/** A GA4 measurement ID (`G-` and letters/digits): anything else is never put into a script URL. */
const GA_MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/

/** Google Analytics' own cookies: `_ga` (client ID) and `_ga_<container>` (session state). */
const GA_COOKIE = /^_ga(_[A-Za-z0-9]+)?$/

/**
 * Loads Google Analytics (gtag.js) with Consent Mode v2. The consent defaults are queued before
 * `config`, so GA never sets or reads a cookie before the visitor accepts: until then (and after
 * Reject) it only sends cookieless pings. Ads signals stay denied for good; this site shows no
 * ads. Loaded here rather than through `@next/third-parties`' `<GoogleAnalytics>`, whose inline
 * script runs `config` with no way to put a consent default ahead of it. Returns whether GA is
 * (now) loaded.
 */
export function loadGoogleAnalytics(gaId: string, choice: ConsentChoice | null): boolean {
  if (typeof window === 'undefined' || !GA_MEASUREMENT_ID.test(gaId)) return false
  if (document.getElementById(GTAG_SCRIPT_ID)) return true

  window.dataLayer = window.dataLayer || []
  const dataLayer = window.dataLayer
  window.gtag = function gtag() {
    // gtag.js only runs commands queued as an `arguments` object, never as an array.
    dataLayer.push(arguments)
  }
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  if (choice === 'granted') window.gtag('consent', 'update', { analytics_storage: 'granted' })
  else deleteCookies(GA_COOKIE)
  window.gtag('js', new Date())
  window.gtag('config', gaId)

  const script = document.createElement('script')
  script.id = GTAG_SCRIPT_ID
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`
  document.head.appendChild(script)
  return true
}

/**
 * Tells a loaded Google Analytics about a changed choice: Accept lets it use its cookies from now
 * on; Reject stops that for the rest of the visit and deletes the cookies it already set.
 */
export function updateGoogleAnalyticsConsent(choice: ConsentChoice | null): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  window.gtag('consent', 'update', { analytics_storage: choice === 'granted' ? 'granted' : 'denied' })
  if (choice !== 'granted') deleteCookies(GA_COOKIE)
}

/**
 * Fires a GA4 custom event through the gtag global `loadGoogleAnalytics` sets up. Works whatever
 * the visitor chose (without consent GA sends it as a cookieless ping); no-ops if GA isn't
 * configured or hasn't loaded yet.
 */
export function trackEvent(name: string, params?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', name, {
      ...params,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    })
  }
}
