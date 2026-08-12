import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://tabmerger.vercel.app'

// ponytail: static list of marketing pages — no CMS/DB-backed routes to
// enumerate dynamically. Dashboard/account/auth/api/share routes are excluded
// since they're private, dynamic, or already blocked in robots.ts.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/features', '/pricing', '/faq', '/changelog', '/privacy', '/terms', '/contact']

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.7,
  }))
}
