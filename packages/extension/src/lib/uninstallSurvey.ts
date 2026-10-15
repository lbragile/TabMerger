import { buildUninstallSurveyUrl } from '@tabmerger/shared';

/**
 * Release channel of this build. Beta store builds are `wxt zip --mode beta` (the same mode
 * `wxt.config.ts` keys the "TabMerger BETA" name and the beta store IDs off); every other
 * registering build, development included, reports `stable` (the survey only accepts `stable`
 * and `beta`).
 */
function releaseChannel(): string {
  return import.meta.env.MODE === 'beta' ? 'beta' : 'stable';
}

/**
 * Only the demo-video build (`VITE_DEMO_BUILD`, see .env.demo) skips the survey. Development
 * builds register it too: they point at the local web app (`VITE_WEB_APP_URL`), so removing a dev
 * build opens the survey on localhost.
 */
function isSurveyBuild(): boolean {
  return import.meta.env.VITE_DEMO_BUILD !== 'true';
}

/**
 * Tells the browser to open the web app's uninstall survey after the extension is removed.
 * Called on every worker start (the version changes with each update). The URL carries only the
 * extension version, the browser and the release channel, never anything about the user.
 * Best effort: never throws, and does nothing when the API, the web app address or the build
 * does not allow it.
 */
export function registerUninstallSurvey(): void {
  try {
    if (!isSurveyBuild()) return;
    if (typeof globalThis.chrome?.runtime?.setUninstallURL !== 'function') return;
    const url = buildUninstallSurveyUrl(import.meta.env.VITE_WEB_APP_URL, {
      version: chrome.runtime.getManifest().version,
      browser: import.meta.env.BROWSER as unknown as string | undefined,
      channel: releaseChannel()
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
