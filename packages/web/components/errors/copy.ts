/**
 * Codes and link sets for the error pages (`app/not-found.tsx`, the `error.tsx` boundaries and
 * `app/global-error.tsx`), kept in one place so the 404 and 500 pages read as one family. Their
 * words are in the `errors` namespace of the message catalog.
 */

/** Which error page: picks the `errors.<kind>` messages and the illustration. */
export type ErrorKind = 'notFound' | 'serverError'

/** The status code drawn large inside the illustration. Decorative: the eyebrow says it in words. */
export const ERROR_CODES: Record<ErrorKind, string> = {
  notFound: '404',
  serverError: '500',
}

export interface ErrorPageLink {
  href: string
  /** Key under `errors.links`. */
  label: 'features' | 'pricing' | 'faq' | 'dashboard' | 'account' | 'contactSupport'
}

/** Where to go from a public page that failed or doesn't exist. */
export const SITE_LINKS: ErrorPageLink[] = [
  { href: '/features', label: 'features' },
  { href: '/pricing', label: 'pricing' },
  { href: '/faq', label: 'faq' },
  { href: '/dashboard', label: 'dashboard' },
  { href: '/contact', label: 'contactSupport' },
]

/** Where to go from a signed-in page (dashboard, account) that failed. */
export const APP_LINKS: ErrorPageLink[] = [
  { href: '/dashboard', label: 'dashboard' },
  { href: '/account', label: 'account' },
  { href: '/faq', label: 'faq' },
  { href: '/contact', label: 'contactSupport' },
]
