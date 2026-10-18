import type { MetadataRoute } from 'next'
import { getMetadataBase } from '@/lib/utils'
import { PUBLIC_LOCALES, localizedPath } from '@/i18n/locales'

/** Signed-in app pages: nothing there for a crawler (signed-out requests redirect to sign-in). */
const APP_PATHS = ['/dashboard', '/account'] as const

/**
 * The signed-in app paths under every public locale: unprefixed for English (`/dashboard`), and
 * `/<locale>/dashboard` for the others, since `app/[locale]/` serves them there too.
 */
export function disallowedPaths(): string[] {
  const paths = new Set<string>()
  for (const locale of PUBLIC_LOCALES) for (const path of APP_PATHS) paths.add(localizedPath(locale, path))
  return [...paths, '/api/']
}

/**
 * `/auth/` and `/share/` are not disallowed: those pages carry a `noindex` meta tag, which a
 * crawler can only read if it may fetch the page. A Disallow alone can leave a linked URL listed
 * in results without its content. The signed-in app (in every locale) and the API stay
 * disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: disallowedPaths(),
    },
    sitemap: new URL('/sitemap.xml', getMetadataBase()).href,
  }
}
