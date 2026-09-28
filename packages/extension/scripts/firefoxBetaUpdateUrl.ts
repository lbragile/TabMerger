import { FIREFOX_BETA } from "@tabmerger/shared";

/**
 * Resolves the Firefox beta add-on's `browser_specific_settings.gecko.update_url` from the
 * beta build's own `VITE_WEB_APP_URL` (the preview web app, e.g.
 * `https://tabmerger-preview.vercel.app`) — extracted out of `wxt.config.ts`'s `manifest()`
 * callback purely so this can be unit-tested without running a real `wxt build`.
 *
 * @param webAppUrl `env.VITE_WEB_APP_URL` as resolved by Vite's `loadEnv()` for the current mode.
 * @throws if `webAppUrl` is unset — a beta Firefox build with no `update_url` would sign and
 *   ship fine, then silently never update again for every tester who installed it. Failing the
 *   build loudly here is cheaper than a beta channel that's gone dark.
 */
export function resolveFirefoxBetaUpdateUrl(webAppUrl: string | undefined): string {
  if (!webAppUrl) {
    throw new Error(
      "wxt.config.ts: Firefox beta build has no VITE_WEB_APP_URL set, so gecko.update_url " +
        "can't be resolved. Without it, the beta .xpi would ship with no way to auto-update. " +
        "Set VITE_WEB_APP_URL (the beta web app, e.g. https://tabmerger-preview.vercel.app) " +
        "before building.",
    );
  }
  return `${webAppUrl}${FIREFOX_BETA.PATH}/${FIREFOX_BETA.UPDATES_FILE}`;
}
