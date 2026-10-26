import type { Breadcrumb, ErrorEvent, Event, EventHint } from '@sentry/nextjs'
import { stripFragmentsDeep, stripUrlFragment, stripUrlOrPathFragment } from '@/lib/analyticsPrivacy'

/** Strip browsing URLs from Sentry events — tab URLs are user PII. */
// ponytail: Sentry v10 changed breadcrumbs from {values: Breadcrumb[]} to Breadcrumb[] directly
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  if (event.request) {
    // Only the method survives. The body (`data`) is dropped too: the server SDK attaches incoming
    // request bodies, and an AI route's body is the user's decrypted group names, tab titles and
    // URLs, which must never leave the request. Query strings and cookies go for the same reason.
    event.request = { method: event.request.method, url: '[redacted]', headers: {} }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = (event.breadcrumbs as Breadcrumb[]).map((b) => ({
      ...b,
      data: b.data ? { ...b.data, url: '[redacted]', from: '[redacted]', to: '[redacted]' } : b.data,
    })) as typeof event.breadcrumbs
  }
  return event
}

/**
 * `beforeBreadcrumb`: removes `#fragments` (a share link's `#key=…`) from a breadcrumb's message and
 * data. Session Replay copies breadcrumbs into its recording as they are added, before any
 * `beforeSend` runs, so this is the only place to clean the ones it records.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    ...breadcrumb,
    ...(typeof breadcrumb.message === 'string' ? { message: stripUrlOrPathFragment(breadcrumb.message) } : {}),
    ...(breadcrumb.data ? { data: stripFragmentsDeep(breadcrumb.data) } : {}),
  }
}

/** A Session Replay recording event (rrweb): `type` 4 is page meta, 5 is Sentry's own breadcrumbs and spans. */
interface RecordingEvent {
  type: number
  data?: unknown
}

const RRWEB_META = 4
const RRWEB_CUSTOM = 5

/**
 * Replay's `beforeAddRecordingEvent`: removes fragments from the page URL (`meta.href`) and from
 * every breadcrumb and span (navigations, fetch/XHR, resources) the recording carries. DOM
 * snapshots are left alone: text is masked and the pages never render the key.
 */
export function scrubRecordingEvent<T extends RecordingEvent>(event: T): T {
  if (event.type !== RRWEB_META && event.type !== RRWEB_CUSTOM) return event
  return { ...event, data: stripFragmentsDeep(event.data) }
}

/**
 * Runs on every event after Sentry has prepared it (the client's `postprocessEvent` hook), so it
 * also covers replay events, which `beforeSend` never sees: their `urls` list and the page URL
 * Sentry adds as `request.url`. Mutates in place, as the hook expects.
 */
export function scrubPreparedEvent(event: Event & { urls?: unknown }): void {
  if (Array.isArray(event.urls)) event.urls = event.urls.map((url) => (typeof url === 'string' ? stripUrlFragment(url) : url))
  if (event.request?.url) event.request.url = stripUrlFragment(event.request.url)
  if (event.request?.headers?.Referer) event.request.headers.Referer = stripUrlFragment(event.request.headers.Referer)
}
