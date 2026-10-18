import { ANALYTICS_DATA_CONSENT_CATEGORIES, buildUninstallSurveyUrl } from '@tabmerger/shared';
import { hasDataConsent, isFirefoxBuild } from './dataConsent';
import { releaseChannel } from './releaseChannel';

/**
 * Only the demo-video build (`VITE_DEMO_BUILD`, see .env.demo) skips the survey. Development
 * builds register it too: they point at the local web app (`VITE_WEB_APP_URL`), so removing a dev
 * build opens the survey on localhost.
 */
function isSurveyBuild(): boolean {
  return import.meta.env.VITE_DEMO_BUILD !== 'true';
}

/** Whether the Firefox consent listeners that re-register the URL are already attached. */
let consentWatchRegistered = false;

/**
 * Re-registers the URL whenever the user grants or revokes a Firefox data-collection category
 * (about:addons included), so the analytics flag in the URL never goes stale.
 */
function watchConsentChanges(): void {
  if (consentWatchRegistered) return;
  consentWatchRegistered = true;
  type PermissionEvent = { addListener: (cb: () => void) => void };
  const permissions = (globalThis.chrome as unknown as { permissions?: { onAdded?: PermissionEvent; onRemoved?: PermissionEvent } })
    ?.permissions;
  permissions?.onAdded?.addListener(() => registerUninstallSurvey());
  permissions?.onRemoved?.addListener(() => registerUninstallSurvey());
}

function setSurveyUrl(analytics: boolean): void {
  try {
    const url = buildUninstallSurveyUrl(import.meta.env.VITE_WEB_APP_URL, {
      version: chrome.runtime.getManifest().version,
      browser: import.meta.env.BROWSER as unknown as string | undefined,
      channel: releaseChannel(),
      analytics
    });
    if (!url) return;
    // Chrome returns a promise in MV3 (and sets lastError when called with a callback); Firefox
    // returns a promise. A rejection (bad URL, too long) must not surface as an unhandled one.
    const result: unknown = chrome.runtime.setUninstallURL(url);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => {});
    }
  } catch {
    // An older browser or a stricter URL check: the survey is optional.
  }
}

/**
 * Tells the browser to open the web app's uninstall survey after the extension is removed.
 * Called on every worker start (the version changes with each update). The URL carries only the
 * extension version, the browser, the release channel and whether analytics are allowed (`a=1`
 * or `a=0`: on Firefox the `technicalAndInteraction` consent, always `1` on Chrome and Edge,
 * which need no opt-in), never anything about the user. The web app records an anonymous
 * `extension_uninstalled` event only when the flag is `1`.
 * Best effort: never throws, and does nothing when the API, the web app address or the build
 * does not allow it.
 */
export function registerUninstallSurvey(): void {
  try {
    if (!isSurveyBuild()) return;
    if (typeof globalThis.chrome?.runtime?.setUninstallURL !== 'function') return;
    if (!isFirefoxBuild()) {
      setSurveyUrl(true);
      return;
    }
    watchConsentChanges();
    void hasDataConsent(ANALYTICS_DATA_CONSENT_CATEGORIES).then(setSurveyUrl, () => setSurveyUrl(false));
  } catch {
    // An older browser or a stricter URL check: the survey is optional.
  }
}

/** Test-only: forgets that the consent listeners were attached. */
export function _resetUninstallSurveyForTests(): void {
  consentWatchRegistered = false;
}
