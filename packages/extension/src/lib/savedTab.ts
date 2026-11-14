import type { Tab } from './types';
import { isOpenableUrl } from './safeOpen';
import { openTabInChromeGroup } from './chromeGroups';

/** The grey page icon shown when a tab has no favicon, or its favicon fails to load. */
export const FALLBACK_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E";

/**
 * A tab row's address column: the hostname (without `www.`) and the start of the path, never the
 * query or hash. Empty for a missing or unparsable URL. The column truncates further by CSS.
 */
export function getUrlDisplay(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, '');
    let path = u.pathname.replace(/\/$/, '');
    if (path.length > 15) path = `${path.slice(0, 15)}...`;
    return path ? `${hostname}${path}` : hostname;
  } catch {
    return '';
  }
}

/**
 * Opens a saved (stored) tab in a new, focused browser tab: inside its browser tab group when it
 * was saved in one (and the browser has tab groups), else as a plain tab. A URL that may not be
 * opened from stored data (`isOpenableUrl`) does nothing.
 */
export async function openSavedTab(tab: Tab): Promise<void> {
  if (!isOpenableUrl(tab.url)) return;
  if (tab.chromeGroup && chrome.tabGroups) {
    await openTabInChromeGroup(tab, undefined, true);
    return;
  }
  await chrome.tabs.create({ url: tab.url, active: true });
}
