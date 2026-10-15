import { STORE_LISTING_URL } from '@tabmerger/shared'
import { isProductionDeployment } from '@/lib/deployment'

/** Path of the beta tester guide (served on every deployment except production). */
export const BETA_GUIDE_PATH = '/beta'

/**
 * `id` of the Firefox step in the beta guide's "Join and install" list: the one step that holds
 * both the install link and what to do with Firefox's prompts.
 */
export const BETA_GUIDE_FIREFOX_ID = 'firefox'

/**
 * Query flag that asks the beta guide to start a beta file on arrival
 * (`?download=firefox`). The guide removes it from the address once it has acted on it.
 */
export const BETA_GUIDE_START_PARAM = 'download'
export const BETA_GUIDE_START_FIREFOX = 'firefox'

/** Where each browser's "install" link goes. `firefox` may be a path on this site. */
export interface StoreLinks {
  chrome: string
  firefox: string
  edge: string
}

/** The public store listings: what the production site links to. */
export const STABLE_STORE_LINKS: StoreLinks = {
  chrome: STORE_LISTING_URL.CHROME_STABLE,
  firefox: STORE_LISTING_URL.FIREFOX_STABLE,
  edge: STORE_LISTING_URL.EDGE_STABLE,
}

/**
 * The beta builds: what every other deployment (preview, local development) links to.
 * - Chrome: the private BETA listing.
 * - Firefox: the beta is unlisted and self-hosted, so there is no store page. The link goes to
 *   the Firefox step of the beta guide on this site and asks the guide to start the beta file
 *   on arrival. This is the only definition of that target: components never build it.
 * - Edge: there is no Edge beta; Edge installs the Chrome BETA item.
 */
export const BETA_STORE_LINKS: StoreLinks = {
  chrome: STORE_LISTING_URL.CHROME_BETA,
  firefox: `${BETA_GUIDE_PATH}?${BETA_GUIDE_START_PARAM}=${BETA_GUIDE_START_FIREFOX}#${BETA_GUIDE_FIREFOX_ID}`,
  edge: STORE_LISTING_URL.CHROME_BETA,
}

/**
 * The install links for the deployment answering this request: the stable listings on
 * production, the beta builds everywhere else.
 *
 * Server only. Call it from a server component (or a route) and pass the result down as props:
 * the deployment is known from `VERCEL_ENV`, which exists on the server but not in the browser,
 * so a client component calling this would always get the beta links, on production too.
 */
export function getStoreLinks(): StoreLinks {
  return isProductionDeployment() ? STABLE_STORE_LINKS : BETA_STORE_LINKS
}

/**
 * The "install it again" links on the uninstall survey page.
 *
 * - Browser known: just that browser's link. Unknown: all three.
 * - Channel `stable`: the public listings. Channel `beta`: the beta builds, except on the
 *   production deployment, where the beta guide (the Firefox beta target) is not served, so the
 *   public listings are used there. Unknown: whatever this deployment links to (`getStoreLinks`).
 *
 * Server only, for the same reason as `getStoreLinks`.
 */
export function getReinstallLinks(
  browser: keyof StoreLinks | undefined,
  channel: 'stable' | 'beta' | undefined
): { browser: keyof StoreLinks; href: string }[] {
  const links =
    channel === 'stable'
      ? STABLE_STORE_LINKS
      : channel === 'beta'
        ? isProductionDeployment()
          ? STABLE_STORE_LINKS
          : BETA_STORE_LINKS
        : getStoreLinks()
  const browsers: (keyof StoreLinks)[] = browser ? [browser] : ['chrome', 'firefox', 'edge']
  return browsers.map((b) => ({ browser: b, href: links[b] }))
}

/** True for a link that leaves this site (a store listing). */
export function isExternalStoreLink(href: string): boolean {
  return /^https?:\/\//.test(href)
}

/**
 * Anchor attributes for an install link that is known to be a store listing (Chrome, Edge): it
 * opens in a new tab. A link into this site gets only its `href`. Safe in client components.
 * For a link that may be internal (Firefox), render `StoreLink` instead, which navigates
 * client-side.
 */
export function storeLinkProps(href: string): { href: string; target?: '_blank'; rel?: 'noopener noreferrer' } {
  return isExternalStoreLink(href) ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href }
}
