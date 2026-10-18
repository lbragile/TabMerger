import { headers } from 'next/headers'
import type { StoreLinks } from '@/lib/storeLinks'

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
 * The header is untrusted: it only picks one of three fixed values and is never echoed back.
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
