import type { StoreLinks } from '@/lib/storeLinks'

/**
 * Which browser to lead an install button row with. Pure functions only (no `next/headers`), so
 * client components can use them too: the blog reads `navigator.userAgent` after hydration
 * instead of the request header, which keeps its pages from rendering per request.
 * `lib/visitorBrowser.ts` re-exports these for server code.
 */

/** A browser TabMerger has an install link for. */
export type InstallBrowser = keyof StoreLinks

/** Display order when the visitor's browser comes first: the others keep this order. */
export const INSTALL_BROWSERS: readonly InstallBrowser[] = ['chrome', 'firefox', 'edge']

/**
 * The browser a User-Agent string belongs to, for choosing which install button to lead with.
 *
 * A plain sniff on purpose: Edge reports `Edg/` (alongside `Chrome/`), Firefox reports
 * `Firefox/`. Everything else, including Chromium browsers (Brave, Vivaldi, Arc, Opera), bots
 * and a missing header, falls back to Chrome, the main store listing.
 *
 * The value is untrusted: it only picks one of three fixed values and is never echoed back.
 */
export function detectInstallBrowser(userAgent: string | null | undefined): InstallBrowser {
  if (!userAgent) return 'chrome'
  if (userAgent.includes('Edg/')) return 'edge'
  if (userAgent.includes('Firefox/')) return 'firefox'
  return 'chrome'
}

/** All install browsers with `primary` first, the rest in `INSTALL_BROWSERS` order. */
export function orderInstallBrowsers(primary: InstallBrowser): InstallBrowser[] {
  return [primary, ...INSTALL_BROWSERS.filter((b) => b !== primary)]
}

/** True for one of the three install browsers (for values read from props, URLs or storage). */
export function isInstallBrowser(value: unknown): value is InstallBrowser {
  return typeof value === 'string' && (INSTALL_BROWSERS as readonly string[]).includes(value)
}
