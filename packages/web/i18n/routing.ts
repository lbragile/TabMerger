import { defineRouting } from 'next-intl/routing'
import { DEFAULT_LOCALE, LOCALES } from './locales'
import { LOCALE_COOKIE_ATTRIBUTES } from './negotiate'

/**
 * next-intl routing. `as-needed`: English keeps today's unprefixed URLs (`/pricing`), other
 * locales live under a prefix (`/es/pricing`). `/en/pricing` redirects to `/pricing`.
 *
 * `alternateLinks: false`: hreflang comes from page metadata and the sitemap (lib/seo.ts,
 * app/sitemap.ts), which only list public locales; the middleware's `Link` header would also
 * list the dev-only pseudo-locale.
 *
 * `localeDetection: true` (next-intl's default, kept explicit on purpose): a visitor's first
 * unprefixed request is matched against the `NEXT_LOCALE` cookie, then `Accept-Language`, and
 * redirected to their language's prefix when it is a shipped locale. Turning it off would pin
 * every unprefixed URL to English and leave the language switcher as the only way in.
 *
 * `localeCookie`: `NEXT_LOCALE` kept for a year (next-intl's default is a session cookie, so a
 * visitor who picked English on a German browser got German again after a browser restart). The
 * language switcher writes the same attributes (`LOCALE_COOKIE_ATTRIBUTES`).
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  alternateLinks: false,
  localeDetection: true,
  localeCookie: LOCALE_COOKIE_ATTRIBUTES,
})
