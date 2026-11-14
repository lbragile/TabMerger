import { isScriptUrl } from '@tabmerger/shared';

/**
 * The one check in front of every `chrome.tabs.create` / `chrome.windows.create` that opens a
 * URL read from stored data (saved tabs, sessions, other devices' snapshots, reminders).
 *
 * A stored URL is opened only when it is a non-empty string that does not use a script-running
 * scheme (`javascript:`, `data:`, `vbscript:`, `blob:`). Every other scheme stays openable:
 * `chrome://`, `edge://`, `about:`, `file://` and extension pages are tabs people really save.
 */
export function isOpenableUrl(url: unknown): url is string {
  return typeof url === 'string' && url !== '' && !isScriptUrl(url);
}

/**
 * The openable URLs of a list, in order. Callers must not pass an empty result to
 * `chrome.windows.create({ url })`: an empty list opens a blank window.
 */
export function openableUrls(urls: readonly unknown[]): string[] {
  return urls.filter(isOpenableUrl);
}

/**
 * Addresses that cannot be opened programmatically, and that saving open tabs leaves out: browser
 * pages (`chrome://`, which includes the new-tab page), `about:` and extension pages. Matches the
 * scheme prefix, so it covers both `about:blank` and `chrome://newtab`.
 */
export const RESTRICTED_URL_RE = /^(chrome|about|chrome-extension|moz-extension):/i;
