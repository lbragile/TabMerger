import { defineRouting } from 'next-intl/routing'
import { DEFAULT_LOCALE, LOCALES } from './locales'

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
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  alternateLinks: false,
  localeDetection: true,
})
