/**
 * Copy and link sets for the error pages (`app/not-found.tsx`, the `error.tsx` boundaries and
 * `app/global-error.tsx`), kept in one place so the 404 and 500 pages read as one family.
 */

export interface ErrorPageCopy {
  /** The status code drawn large inside the illustration. Decorative: the eyebrow says it in words. */
  code: string
  /** Small line above the heading, naming the status for screen readers and sighted users alike. */
  eyebrow: string
  /** The page's only `<h1>`. */
  title: string
  description: string
  /** Document title (the root layout's template adds " | TabMerger" where metadata applies). */
  documentTitle: string
}

export const NOT_FOUND_COPY: ErrorPageCopy = {
  code: '404',
  eyebrow: 'Error 404 · Page not found',
  title: 'This tab wandered off',
  description:
    "We looked through every group and couldn't find this page. It may have moved, been closed, or never existed. Let's get you back on track.",
  documentTitle: 'Page not found',
}

export const SERVER_ERROR_COPY: ErrorPageCopy = {
  code: '500',
  eyebrow: 'Error 500 · Something went wrong',
  title: 'This tab crashed',
  description:
    'Something broke on our side while loading this page. Your tabs and groups in the extension are not affected. Try again in a moment.',
  documentTitle: 'Something went wrong',
}

export interface ErrorPageLink {
  href: string
  label: string
}

/** Where to go from a public page that failed or doesn't exist. */
export const SITE_LINKS: ErrorPageLink[] = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/contact', label: 'Contact support' },
]

/** Where to go from a signed-in page (dashboard, account) that failed. */
export const APP_LINKS: ErrorPageLink[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/account', label: 'Account' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact support' },
]

export const REFERENCE_ID_HINT = 'Quote this ID if you contact support, so we can find what went wrong.'
