import { headers } from 'next/headers'
import { detectInstallBrowser, type InstallBrowser } from '@/lib/installBrowser'

// The pure helpers live in lib/installBrowser.ts so client code can import them without pulling
// in `next/headers`; they are re-exported here for the server callers that already use this file.
export { INSTALL_BROWSERS, detectInstallBrowser, isInstallBrowser, orderInstallBrowsers } from '@/lib/installBrowser'
export type { InstallBrowser } from '@/lib/installBrowser'

/**
 * The visitor's browser, from this request's User-Agent header.
 *
 * Server only. Reading the header makes the calling route render per request; call it from a
 * page and pass the result to the install components as a prop, so they stay plain (testable)
 * server components and the server HTML already has the right order (no flash on hydration).
 */
export async function getVisitorBrowser(): Promise<InstallBrowser> {
  const requestHeaders = await headers()
  return detectInstallBrowser(requestHeaders.get('user-agent'))
}
