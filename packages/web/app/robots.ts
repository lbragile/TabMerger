import type { MetadataRoute } from 'next'
import { getMetadataBase } from '@/lib/utils'

/**
 * `/auth/` and `/share/` are not disallowed: those pages carry a `noindex` meta tag, which a
 * crawler can only read if it may fetch the page. A Disallow alone can leave a linked URL listed
 * in results without its content. The signed-in app and the API stay disallowed: there is nothing
 * there for a crawler (signed-out requests redirect to sign-in).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/account', '/api/'],
    },
    sitemap: new URL('/sitemap.xml', getMetadataBase()).href,
  }
}
