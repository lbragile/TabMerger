import type { NextRequest } from 'next/server'
import { DOWNLOAD_FALLBACK_PATH, downloadTarget } from '@/lib/download'
import { getStoreLinks } from '@/lib/storeLinks'

// Depends on the request's User-Agent: never cached or prerendered.
export const dynamic = 'force-dynamic'

/**
 * `/download`: one short install link for shared text. Sends the visitor's browser to its store
 * listing for this deployment (`getStoreLinks()`: stable on production, the beta builds
 * elsewhere), or to the homepage's install section when the browser can't install it (Safari,
 * phones, bots). Not localized, not indexed (`X-Robots-Tag: noindex`), not in the sitemap.
 */
export function GET(request: NextRequest) {
  const browser = downloadTarget(request.headers.get('user-agent'))
  const target = browser ? getStoreLinks()[browser] : DOWNLOAD_FALLBACK_PATH
  // Store links are absolute; the Firefox beta guide and the fallback are paths on this site.
  const location = new URL(target, request.nextUrl.origin)
  return new Response(null, {
    status: 302,
    headers: {
      Location: location.href,
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'private, no-store',
      Vary: 'User-Agent',
    },
  })
}
