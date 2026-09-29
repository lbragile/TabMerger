import type { FirefoxDataConsentCategory } from '@tabmerger/shared';

/**
 * Firefox's `browser.permissions` "data collection" consent — the runtime counterpart of
 * `wxt.config.ts`'s `gecko.data_collection_permissions` manifest declaration (see
 * `@tabmerger/shared`'s `firefoxDataConsent.ts` for the shared category list and why each one
 * applies). Optional categories are NOT granted by default — Firefox requires an explicit
 * `permissions.request()` call (or, for `technicalAndInteraction` specifically, ticking an
 * install-time checkbox) before the extension may actually collect/transmit that category.
 *
 * On Chrome/Edge (`!import.meta.env.FIREFOX`) this whole API doesn't exist — every function here
 * short-circuits to "granted" without touching `chrome.permissions`, so nothing changes for those
 * browsers.
 */

// `data_collection` isn't in @types/chrome's Permissions shape (Firefox-only extension to the
// permissions API) — a minimal local shape for the one field this module actually touches.
interface DataCollectionPermissions {
  data_collection?: FirefoxDataConsentCategory[];
}

// Module-level cache, updated by `permissions.onAdded`/`onRemoved` (fires when the user grants
// or revokes a category from about:addons, not just via our own request() calls) so a stale
// "granted" doesn't linger after a revocation made outside the popup.
const consentCache = new Map<FirefoxDataConsentCategory, boolean>();
let listenersRegistered = false;

export function isFirefoxBuild(): boolean {
  // ponytail: `import.meta.env.FIREFOX` is a real boolean at build time (a WXT-injected Vite
  // `define`), but `vi.stubEnv()` in tests only ever assigns strings — `Boolean('false')` is
  // `true`, so a naive `Boolean(...)` here would treat a test's explicit "not Firefox" stub as
  // Firefox. Accept both the real boolean and vitest's stringified form.
  const flag = import.meta.env.FIREFOX as unknown;
  return flag === true || flag === 'true';
}

// A minimal local shape for the two Firefox-only events this module listens to — deliberately
// NOT intersected with @types/chrome's own `chrome.permissions` typing (whose `onAdded`/
// `onRemoved` callbacks are typed with the Chrome-only `Permissions` shape, which doesn't know
// about `data_collection` either), to avoid the two conflicting callback signatures merging into
// an unsatisfiable intersection type.
interface FirefoxPermissionsEvents {
  onAdded?: { addListener: (cb: (perms: DataCollectionPermissions) => void) => void };
  onRemoved?: { addListener: (cb: (perms: DataCollectionPermissions) => void) => void };
}

function ensureListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;
  const permissionsApi = chrome.permissions as unknown as FirefoxPermissionsEvents | undefined;
  permissionsApi?.onAdded?.addListener((perms) => {
    (perms.data_collection ?? []).forEach((c) => consentCache.set(c, true));
  });
  permissionsApi?.onRemoved?.addListener((perms) => {
    (perms.data_collection ?? []).forEach((c) => consentCache.set(c, false));
  });
}

/**
 * Whether every category in `categories` is currently granted. Safe to call anywhere (no user
 * gesture required) — `permissions.contains` is a plain read.
 */
export async function hasDataConsent(categories: readonly FirefoxDataConsentCategory[]): Promise<boolean> {
  if (!isFirefoxBuild()) return true;
  if (categories.length === 0) return true;
  ensureListeners();
  try {
    const granted = await chrome.permissions.contains({
      data_collection: categories,
    } as unknown as chrome.permissions.Permissions);
    categories.forEach((c) => consentCache.set(c, granted));
    return granted;
  } catch {
    return false;
  }
}

/**
 * Prompts the user for `categories`. On Firefox, `permissions.request()` only succeeds when
 * called synchronously inside a user-activated event handler (a click handler with no prior
 * `await`) — call this as the FIRST thing the handler does, before any other asynchronous work,
 * or Firefox silently rejects the request as not user-activated.
 */
export async function requestDataConsent(categories: readonly FirefoxDataConsentCategory[]): Promise<boolean> {
  if (!isFirefoxBuild()) return true;
  if (categories.length === 0) return true;
  ensureListeners();
  try {
    const granted = await chrome.permissions.request({
      data_collection: categories,
    } as unknown as chrome.permissions.Permissions);
    categories.forEach((c) => consentCache.set(c, granted));
    return granted;
  } catch {
    return false;
  }
}

/** Synchronous best-effort read of the last known grant state — `undefined` if never checked. */
export function getCachedDataConsent(category: FirefoxDataConsentCategory): boolean | undefined {
  return consentCache.get(category);
}

/** Test-only: clears the module-level cache and listener-registration flag between test cases. */
export function _resetDataConsentForTests(): void {
  consentCache.clear();
  listenersRegistered = false;
}
