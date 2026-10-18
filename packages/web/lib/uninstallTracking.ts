import { randomUUID } from 'node:crypto'
import { ANALYTICS_EVENTS, parseUninstallSurveyParams, uninstallAnalyticsAllowed } from '@tabmerger/shared'
import { gaEnvironment, sendGa4Event, type Ga4Params } from '@/lib/ga4'

/**
 * Server side of the `extension_uninstalled` event: the uninstall page (`/uninstalled`, opened
 * by the browser after the extension is removed) asks the server to record it once per page view
 * (`components/uninstall/UninstallTracker.tsx`). Sent with the Measurement Protocol from the
 * server, so an ad blocker in the browser can't drop it.
 *
 * Server-only.
 */

/** The query values the page read from its URL. Anything can arrive here: it's re-checked. */
export interface RawUninstallParams {
  version?: unknown
  browser?: unknown
  channel?: unknown
  analytics?: unknown
}

/**
 * The GA4 params for an uninstall, or `null` when it must not be recorded: the URL says the
 * install did not consent to analytics (`a=0`), or it carries no flag and the browser is not one
 * whose builds send analytics without asking (see `uninstallAnalyticsAllowed`).
 *
 * Only allow-listed values survive: a known browser and channel, and a version matching the
 * manifest-version pattern (at most 23 characters). Unknown values are left out, never forwarded.
 */
export function uninstallEventParams(raw: unknown): Ga4Params | null {
  const input = (raw && typeof raw === 'object' ? raw : {}) as RawUninstallParams
  const parsed = parseUninstallSurveyParams({
    version: input.version,
    browser: input.browser,
    channel: input.channel,
    analytics: input.analytics,
  })
  if (!uninstallAnalyticsAllowed(parsed)) return null
  const params: Ga4Params = { environment: gaEnvironment() }
  if (parsed.browser) params.browser = parsed.browser
  if (parsed.version) params.extension_version = parsed.version
  if (parsed.channel) params.channel = parsed.channel
  return params
}

/**
 * Records one `extension_uninstalled` event in the extension's GA4 property. Resolves `true` when
 * it was sent. The client id is random per event: the URL carries nothing that identifies the
 * install, so GA counts each uninstall as a new anonymous client (read uninstalls as an event
 * count, not as users; see docs/ANALYTICS.md).
 */
export async function trackUninstall(raw: unknown): Promise<boolean> {
  const params = uninstallEventParams(raw)
  if (!params) return false
  return sendGa4Event('extension', {
    clientId: randomUUID(),
    name: ANALYTICS_EVENTS.extensionUninstalled,
    params,
  })
}
