import type { MetadataRoute } from 'next'
import { getMetadataBase } from '@/lib/utils'
import { DEFAULT_LOCALE, PUBLIC_LOCALES, localizedPath } from '@/i18n/locales'

// ponytail: static list of marketing pages — no CMS/DB-backed routes to
// enumerate dynamically. Dashboard/account/auth/api/share routes are excluded
// since they're private, dynamic, or noindex. The beta tester guide (/beta)
// is left out on purpose: it is not served on the production deployment (see lib/deployment.ts).
//
// No `lastModified`: there is no reliable per-page date, and stamping every URL with the build
// time teaches search engines to ignore the field. Leaving it out is better than a wrong date.
export const SITEMAP_PATHS = ['/', '/features', '/pricing', '/faq', '/changelog', '/privacy', '/terms', '/contact']

/** Pages that exist in English only, under every locale (the binding legal text). */
export const ENGLISH_ONLY_PATHS: ReadonlySet<string> = new Set(['/privacy', '/terms'])

/**
 * One entry per page and public locale, each listing every language version of its page
 * (hreflang). Only English is public today, so it is one entry per page with an `en` alternate.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getMetadataBase()
  const href = (locale: string, path: string) => new URL(localizedPath(locale, path), base).href
  return SITEMAP_PATHS.flatMap((path) => {
    const locales = ENGLISH_ONLY_PATHS.has(path) ? [DEFAULT_LOCALE] : PUBLIC_LOCALES
    const languages = Object.fromEntries(locales.map((locale) => [locale, href(locale, path)]))
    return locales.map((locale) => ({
      url: href(locale, path),
      changeFrequency: path === '/' ? ('weekly' as const) : ('monthly' as const),
      priority: path === '/' ? 1 : 0.7,
      alternates: { languages },
    }))
  })
}
