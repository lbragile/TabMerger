import type { MetadataRoute } from 'next'
import { getMetadataBase } from '@/lib/utils'

// ponytail: static list of marketing pages — no CMS/DB-backed routes to
// enumerate dynamically. Dashboard/account/auth/api/share routes are excluded
// since they're private, dynamic, or noindex. The beta tester guide (/beta)
// is left out on purpose: it is not served on the production deployment (see lib/deployment.ts).
//
// No `lastModified`: there is no reliable per-page date, and stamping every URL with the build
// time teaches search engines to ignore the field. Leaving it out is better than a wrong date.
export const SITEMAP_PATHS = ['/', '/features', '/pricing', '/faq', '/changelog', '/privacy', '/terms', '/contact']

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getMetadataBase()
  return SITEMAP_PATHS.map((path) => ({
    url: new URL(path, base).href,
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : 0.7,
  }))
}
