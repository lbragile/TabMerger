import { isFirefoxBuild } from '@/lib/dataConsent';
import { resolveTrustedWebAppOrigins, toOriginMatchPatterns } from '@/lib/webAppOrigins';

/**
 * Firefox site access for the web-bridge content script's sites.
 *
 * The bridge (`entrypoints/web-bridge.content.ts`) runs on every trusted web app origin
 * (`VITE_WEB_APP_URL` plus `VITE_EXTRA_WEB_APP_URLS`, resolved by `lib/webAppOrigins.ts`, the one
 * source of that list). Firefox MV3 treats content-script matches as optional host access: all of
 * them are granted on a fresh install, but a site ADDED by an update is neither prompted for nor
 * granted, so an existing install can't run the bridge there until the user allows it. Those
 * matches are also requestable optional origins in MV3, so `permissions.request({ origins })`
 * can grant them with no manifest change.
 *
 * The request is made from an extension tab (`entrypoints/site-access/`), never from the popup:
 * Firefox shows no permission prompt over an open browser-action popup, only after it closes, and
 * by then the popup that asked is gone, so its promise never settles anywhere and the UI never
 * updates. The popup's banner opens that tab instead (`openWebAppHostAccessPage()`) and then
 * closes itself (`closePopupView()`), because opening a tab leaves a Firefox popup open.
 *
 * Chrome and Edge reach the website through `externally_connectable`, which is not a permission,
 * so everything here is Firefox-only and reports "nothing to do" elsewhere.
 */

/** chrome.storage.local key: the patterns the user dismissed the prompt for. */
export const WEB_APP_ACCESS_DISMISSED_KEY = 'webAppAccessDismissed';

/** Built path of the Firefox-only page that asks for site access (`entrypoints/site-access/`). */
export const WEB_APP_ACCESS_PAGE_PATH = '/site-access.html';

/**
 * The match patterns the bridge runs on, when the popup should look after them: Firefox builds
 * only. Fails closed (empty) on a value the parser rejects; such a value already failed the build.
 */
export function webAppHostPatterns(): string[] {
  if (!isFirefoxBuild()) return [];
  try {
    return toOriginMatchPatterns(
      resolveTrustedWebAppOrigins(import.meta.env.VITE_WEB_APP_URL, import.meta.env.VITE_EXTRA_WEB_APP_URLS, {
        allowLocalhostHttp: import.meta.env.MODE === 'development',
      })
    );
  } catch {
    return [];
  }
}

/**
 * The patterns from `webAppHostPatterns()` that Firefox has not granted, in that order. A plain
 * read, safe anywhere. Any API error reads as "nothing missing", so the popup never shows a
 * prompt it can't act on.
 */
export async function getMissingWebAppHostPatterns(): Promise<string[]> {
  const patterns = webAppHostPatterns();
  if (patterns.length === 0) return [];
  try {
    const granted = await Promise.all(patterns.map((origin) => chrome.permissions.contains({ origins: [origin] })));
    return patterns.filter((_, i) => !granted[i]);
  } catch {
    return [];
  }
}

/**
 * Asks Firefox for `patterns`. Call it only from the site-access tab, never from the popup (see
 * the module comment), and synchronously from a click handler with nothing awaited before it:
 * Firefox only allows `permissions.request()` inside a user action. Resolves to whether the user
 * granted them; a refusal or an API error resolves to false.
 */
export function requestWebAppHostAccess(patterns: readonly string[]): Promise<boolean> {
  if (patterns.length === 0) return Promise.resolve(true);
  try {
    return chrome.permissions.request({ origins: [...patterns] }).then(Boolean, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Opens the site-access tab, active, which asks Firefox for the missing sites itself. The tab
 * works out what is missing on its own, so nothing is passed in the URL. Resolves to false when
 * the tab could not be opened.
 *
 * Opening a tab does NOT close a Firefox popup: the new tab opens behind it and the popup stays
 * open until the user clicks away, so the caller closes it (`closePopupView()`).
 */
export function openWebAppHostAccessPage(): Promise<boolean> {
  try {
    return chrome.tabs.create({ url: chrome.runtime.getURL(WEB_APP_ACCESS_PAGE_PATH), active: true }).then(
      () => true,
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Closes this page when it is the browser-action popup, so the user lands on a tab the popup
 * just opened. Does nothing when `popup.html` is open as an ordinary tab (closing that would
 * close the user's tab). When the browser can't list its views, the caller is assumed to be the
 * popup, the only place that renders the banner calling this.
 */
export function closePopupView(): void {
  try {
    const views = chrome.extension?.getViews?.({ type: 'popup' });
    if (views && !views.includes(window)) return;
    window.close();
  } catch {
    // Not closable; the popup stays open and the new tab is still there behind it.
  }
}

/** The patterns the prompt was dismissed for; anything malformed reads as none. */
export async function getDismissedWebAppHostPatterns(): Promise<string[]> {
  try {
    const stored = (await chrome.storage.local.get(WEB_APP_ACCESS_DISMISSED_KEY))[WEB_APP_ACCESS_DISMISSED_KEY];
    return Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Remembers a dismissal for exactly these patterns, so the prompt stays hidden for them and
 * comes back only if a site that wasn't dismissed goes missing (a later build adding one).
 */
export async function dismissWebAppHostPatterns(patterns: readonly string[]): Promise<void> {
  const merged = [...new Set([...(await getDismissedWebAppHostPatterns()), ...patterns])];
  try {
    await chrome.storage.local.set({ [WEB_APP_ACCESS_DISMISSED_KEY]: merged });
  } catch {
    // Not remembered; the prompt is still hidden for this popup session.
  }
}

/** `https://tabmerger.com/*` to `tabmerger.com`, for the prompt's copy. */
export function hostOfPattern(pattern: string): string {
  try {
    return new URL(pattern.replace(/\/\*$/, '/')).host;
  } catch {
    return pattern;
  }
}
