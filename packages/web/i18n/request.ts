import { hasLocale } from 'next-intl'
import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { routing } from './routing'
import { loadMessages } from './messages'
import { LOCALE_COOKIE, negotiateLocale } from './negotiate'

/**
 * Per-request next-intl config. The locale comes from the `[locale]` segment (or the proxy's
 * locale header); anything that isn't a routable locale falls back to the default, and the
 * `[locale]` layout has already answered 404 for an unknown segment.
 *
 * Routes outside `app/[locale]/` (`/auth/*`, the root 404 and 500 pages) have no segment: for
 * those the locale is negotiated from the `NEXT_LOCALE` cookie, then `Accept-Language`
 * (`negotiate.ts`), so they speak the visitor's language while keeping their unprefixed URLs.
 * Reading the request's cookies and headers makes those routes dynamic; the localized pages
 * never get here without a segment, so their static rendering is unaffected.
 *
 * No `timeZone`: the site formats dates in the reader's browser or with an explicit zone,
 * exactly as it did before translation.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  let locale: string
  if (requested === undefined) {
    const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
    locale = negotiateLocale(
      cookieStore.get(LOCALE_COOKIE)?.value,
      headerList.get('accept-language'),
      routing.locales,
      routing.defaultLocale
    )
  } else {
    locale = requested
  }
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale
  return { locale: resolved, messages: await loadMessages(resolved) }
})
