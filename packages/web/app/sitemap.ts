import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://tabmerger.vercel.app'

// ponytail: static list of marketing pages — no CMS/DB-backed routes to
// enumerate dynamically. Dashboard/account/auth/api/share routes are excluded
// since they're private, dynamic, or already blocked in robots.ts. The beta tester guide (/beta)
// is left out on purpose: it is not served on the production deployment (see lib/deployment.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ['', '/features', '/pricing', '/faq', '/changelog', '/privacy', '/terms', '/contact']

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'weekly' : 'monthly',
    priority: route === '' ? 1 : 0.7,
  }))
}
