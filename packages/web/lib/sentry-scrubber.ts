import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/nextjs'

/** Strip browsing URLs from Sentry events — tab URLs are user PII. */
// ponytail: Sentry v10 changed breadcrumbs from {values: Breadcrumb[]} to Breadcrumb[] directly
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent | null {
  if (event.request) {
    event.request = { ...event.request, url: '[redacted]', headers: {} }
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = (event.breadcrumbs as Breadcrumb[]).map((b) => ({
      ...b,
      data: b.data ? { ...b.data, url: '[redacted]', from: '[redacted]', to: '[redacted]' } : b.data,
    })) as typeof event.breadcrumbs
  }
  return event
}
