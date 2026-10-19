/**
 * What the website's analytics must never receive: the decrypted tabs and groups shown on the
 * signed-in pages and on a shared link's page, the visitor's email, and a URL's `#fragment` (a
 * share link carries its decryption key there, `#key=…`). The server never holds those keys or
 * that plaintext, so neither may PostHog or Google Analytics.
 *
 * - `NO_CAPTURE_CLASS` on an element blocks it and everything inside it from PostHog's session
 *   replay (drawn as an empty box) and from its click autocapture. Put it on any container that
 *   shows decrypted or personal data.
 * - Popups (menus, tooltips, dialogs) render outside those containers, at the end of `<body>`, so
 *   `REPLAY_BLOCK_SELECTOR` blocks them from replay everywhere.
 * - `scrubPostHogEvent` (PostHog's `before_send`) drops click-style events on the private pages
 *   (portalled popups again) and strips fragments from every URL in every event.
 *
 * Google Analytics needs nothing here: gtag.js already leaves the fragment out of `page_location`
 * (checked against the real gtag.js on `/share/abc#key=…`: it sent `dl=…/share/abc`).
 */

import { LOCALES } from '@/i18n/locales'

/** PostHog's own "never capture" class: honoured by session replay and by autocapture. */
export const NO_CAPTURE_CLASS = 'ph-no-capture'

/**
 * Session replay blocks these too: Radix popups (dropdowns, tooltips, popovers, selects all sit in
 * a popper wrapper) and dialogs. They are portalled to `<body>`, out of reach of a container's
 * `NO_CAPTURE_CLASS`, and on the dashboard they show group and tab names.
 */
export const REPLAY_BLOCK_SELECTOR = [
  `.${NO_CAPTURE_CLASS}`,
  '[data-radix-popper-content-wrapper]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(', ')

/** Pages that show decrypted tab data or account details: the signed-in pages and shared links. */
const PRIVATE_SECTIONS: readonly string[] = ['/dashboard', '/account', '/share']

/** `/de/dashboard` → `/dashboard`; anything without a locale prefix as it is. */
function withoutLocale(pathname: string): string {
  const [, first] = pathname.split('/')
  if (!first || !(LOCALES as readonly string[]).includes(first)) return pathname
  return pathname.slice(first.length + 1) || '/'
}

/** Whether `pathname` (with or without a locale prefix) is one of the private sections. */
export function isPrivateContentPath(pathname: string): boolean {
  const path = withoutLocale(pathname)
  return PRIVATE_SECTIONS.some((section) => path === section || path.startsWith(`${section}/`))
}

/** `https://x/share/a#key=…` → `https://x/share/a`. Anything that isn't an http(s) URL as it is. */
export function stripUrlFragment(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value
  const hash = value.indexOf('#')
  return hash === -1 ? value : value.slice(0, hash)
}

/**
 * Like `stripUrlFragment`, but also for site-relative paths (`/share/a#key=…` → `/share/a`), which
 * is how Sentry records client-side navigations. Other strings (`Group #1`) stay as they are.
 */
export function stripUrlOrPathFragment(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return stripUrlFragment(value)
  const hash = value.indexOf('#')
  return hash === -1 ? value : value.slice(0, hash)
}

/**
 * Returns `value` with `stripUrlOrPathFragment` applied to every string inside it (objects and
 * arrays are copied, never mutated). Used on Sentry Replay's breadcrumb and span payloads.
 */
export function stripFragmentsDeep<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return stripUrlOrPathFragment(value) as T
  if (depth > 8 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => stripFragmentsDeep(item, depth + 1)) as T
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) out[key] = stripFragmentsDeep(item, depth + 1)
  return out as T
}

type Properties = Record<string, unknown>

function scrubUrls(properties: Properties | undefined): Properties | undefined {
  if (!properties) return properties
  let changed: Properties | null = null
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== 'string') continue
    const stripped = stripUrlFragment(value)
    if (stripped === value) continue
    changed ??= { ...properties }
    changed[key] = stripped
  }
  return changed ?? properties
}

/** Events that describe what was clicked or copied: their element text and attributes can hold tab data. */
const INTERACTION_EVENTS: ReadonlySet<string> = new Set([
  '$autocapture',
  '$rageclick',
  '$dead_click',
  '$copy_autocapture',
  '$$heatmap',
])

/** The path of the page an event was captured on, from its `$pathname` or `$current_url`. */
function eventPath(properties: Properties): string | null {
  if (typeof properties.$pathname === 'string') return properties.$pathname
  if (typeof properties.$current_url === 'string') {
    try {
      return new URL(properties.$current_url).pathname
    } catch {
      return null
    }
  }
  return null
}

interface ScrubbableEvent {
  event: string
  properties: Properties
  $set?: Properties
  $set_once?: Properties
}

/**
 * PostHog's `before_send`: drops click, copy and heatmap events captured on a private page (an
 * unknown page counts as private), and removes the `#fragment` from every http(s) URL in an
 * event's properties and in the person properties it sets (`$set`, `$set_once`). Session replay
 * data is left to `disable_capture_url_hashes` and the block rules above.
 */
export function scrubPostHogEvent<T extends ScrubbableEvent>(event: T | null): T | null {
  if (!event) return event
  if (INTERACTION_EVENTS.has(event.event)) {
    const path = eventPath(event.properties ?? {})
    if (path === null || isPrivateContentPath(path)) return null
  }
  return {
    ...event,
    properties: scrubUrls(event.properties) ?? event.properties,
    ...(event.$set ? { $set: scrubUrls(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubUrls(event.$set_once) } : {}),
  }
}
