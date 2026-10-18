/**
 * Server-side GA4 Measurement Protocol sender, shared by every route that records an event from
 * the server (`/api/track`, the uninstall page, the web heartbeat cron, the Stripe webhook).
 * Server-side events can't be dropped by ad blockers, and the API secrets never reach a browser.
 *
 * Two GA4 data streams:
 * - `web`: the site's own property (`NEXT_PUBLIC_GA_MEASUREMENT_ID` + `GA_API_SECRET`).
 * - `extension`: the extension's property (`GA_EXTENSION_MEASUREMENT_ID` + `GA_EXTENSION_API_SECRET`),
 *   where install / update / uninstall / heartbeat events live.
 *
 * Server-only: never import this from a client component.
 */

export type Ga4Stream = 'web' | 'extension'

/** One GA4 e-commerce item (`items[]` on `purchase`, `begin_checkout` and the like). */
export type Ga4Item = Record<string, string | number>

/** Event parameters: flat values, plus GA4's e-commerce `items` array. */
export type Ga4Params = Record<string, string | number | Ga4Item[]>

/** GA4's rule for event and parameter names: a letter, then letters, digits or underscores, 40 at most. */
export const GA_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
/** GA4's limits on one event: 25 parameters, 100 characters per string value. */
export const GA_MAX_PARAMS = 25
export const GA_MAX_STRING_VALUE = 100
export const GA_MAX_CLIENT_ID = 100

const COLLECT_URL = 'https://www.google-analytics.com/mp/collect'

/** How long one Measurement Protocol request may take before it is aborted. */
export const GA_TIMEOUT_MS = 2000

function credentials(stream: Ga4Stream): { measurementId: string; apiSecret: string } | null {
  const measurementId =
    stream === 'web' ? process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID : process.env.GA_EXTENSION_MEASUREMENT_ID
  const apiSecret = stream === 'web' ? process.env.GA_API_SECRET : process.env.GA_EXTENSION_API_SECRET
  if (!measurementId || !apiSecret) return null
  return { measurementId, apiSecret }
}

/** Whether the stream's measurement ID and API secret are both set. */
export function isGa4Configured(stream: Ga4Stream): boolean {
  return credentials(stream) !== null
}

/**
 * Sends one event to the stream's GA4 property. Resolves `true` when GA accepted the request,
 * `false` when the stream isn't configured, the request failed or GA answered with an error.
 * Never throws: a GA outage must never surface to the caller. A request GA hasn't answered
 * within GA_TIMEOUT_MS is aborted and resolves `false`, so a slow GA can't hold a route open.
 *
 * GA4 answers 2xx even for a malformed event (it only validates on `/debug/mp/collect`), so
 * callers keep names and values within the limits above themselves.
 *
 * There is deliberately no `user_id`: the privacy policy promises GA data is not linked to an
 * account, so `clientId` must never be derived from one.
 */
export async function sendGa4Event(
  stream: Ga4Stream,
  event: { clientId: string; name: string; params?: Ga4Params }
): Promise<boolean> {
  const creds = credentials(stream)
  if (!creds) return false
  const url = `${COLLECT_URL}?measurement_id=${encodeURIComponent(creds.measurementId)}&api_secret=${encodeURIComponent(creds.apiSecret)}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ client_id: event.clientId, events: [{ name: event.name, params: event.params }] }),
      signal: AbortSignal.timeout(GA_TIMEOUT_MS),
    })
    return res?.ok !== false
  } catch {
    return false
  }
}

/** Trims a string to GA4's per-value limit. */
export function gaValue(value: string): string {
  return value.slice(0, GA_MAX_STRING_VALUE)
}

/**
 * The deployment the event came from (`production`, `preview`, or `development` locally), the
 * same `environment` field `lib/analytics.ts` adds to every browser-side event.
 */
export function gaEnvironment(): string {
  const env = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV
  return env === 'production' || env === 'preview' ? env : 'development'
}
