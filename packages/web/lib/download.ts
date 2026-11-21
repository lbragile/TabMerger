import type { InstallBrowser } from '@/lib/installBrowser'

/** The short install link shared in posts and messages (`<origin>/download`). */
export const DOWNLOAD_PATH = '/download'

/** Where `/download` sends a browser it can't install into: the homepage's install section. */
export const DOWNLOAD_FALLBACK_PATH = '/#install'

/** Phones and tablets: no store there installs the desktop extension. */
const MOBILE = /Android|iPhone|iPad|iPod|Mobile/i
/** Crawlers and link previews: they get the homepage, never a store redirect. */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview/i

/**
 * Which store `/download` sends a User-Agent to: Edge (`Edg/`) to Edge, Firefox to Firefox,
 * Chrome and other desktop Chromium browsers (Brave, Vivaldi, Opera, Arc report `Chrome/`) to
 * Chrome. `null` (the homepage's install section) for everything else: Safari, phones, bots, an
 * empty header. The header is untrusted; it only picks one of these fixed answers.
 */
export function downloadTarget(userAgent: string | null | undefined): InstallBrowser | null {
  if (!userAgent || MOBILE.test(userAgent) || BOT.test(userAgent)) return null
  if (userAgent.includes('Edg/')) return 'edge'
  if (userAgent.includes('Firefox/')) return 'firefox'
  if (userAgent.includes('Chrome/') || userAgent.includes('Chromium/')) return 'chrome'
  return null
}
