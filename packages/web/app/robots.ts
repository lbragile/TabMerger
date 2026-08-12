import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://tabmerger.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/account', '/auth/', '/api/', '/share/'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
