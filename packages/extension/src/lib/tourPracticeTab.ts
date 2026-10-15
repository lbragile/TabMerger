/**
 * The spare browser tab of the guided tour's "save a tab" step.
 *
 * Saving a tab closes it in the browser, so the tour never asks for one of the user's: it opens
 * a page of its own, in the background, and that is the only tab the step lets the user move.
 * The page ships with the extension (`public/tour-practice.html`), so opening it needs no
 * permission and nothing is fetched from the network.
 *
 * Closing is guarded twice: only the id the tour itself got back from `chrome.tabs.create` is
 * ever passed in, and even then the tab is closed only while it still shows the practice page.
 * An id that now belongs to another tab (ids can be handed out again after a browser restart)
 * therefore closes nothing.
 */

/** File name of the practice page inside the extension package. */
export const TOUR_PRACTICE_PAGE = 'tour-practice.html';

/** Title of the practice page: how the tab reads in "Now Open" and in the browser's tab strip. */
export const TOUR_PRACTICE_TAB_TITLE = 'Tour practice tab';

/** Full address of the practice page, or `''` when the extension runtime is not there (tests). */
export function tourPracticeTabUrl(): string {
  try {
    return (chrome.runtime.getURL as (path: string) => string)(TOUR_PRACTICE_PAGE);
  } catch {
    return '';
  }
}

/** True for the address of the practice page (with or without a query or a fragment). */
export function isTourPracticeUrl(url: unknown): boolean {
  const page = tourPracticeTabUrl();
  if (!page || typeof url !== 'string') return false;
  return url === page || url.startsWith(`${page}?`) || url.startsWith(`${page}#`);
}

/**
 * The windows given, without any tab that shows the practice page (and without a window that
 * held nothing else). For copies of "Now Open" that leave the device: the tour's spare tab is
 * not the user's and must never be part of one. Returns the same array when there is none.
 */
export function withoutTourPracticeTabs<W extends { tabs: readonly { url?: string }[] }>(windows: readonly W[]): W[] {
  if (!windows.some((w) => w.tabs.some((t) => isTourPracticeUrl(t?.url)))) return windows as W[];
  return windows
    .map((w) => ({ ...w, tabs: w.tabs.filter((t) => !isTourPracticeUrl(t?.url)) }))
    .filter((w) => w.tabs.length > 0) as W[];
}

/** True while the tab with this id exists and shows the practice page. Never throws. */
export async function isTourPracticeTabOpen(tabId: number | null | undefined): Promise<boolean> {
  if (typeof tabId !== 'number') return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    return isTourPracticeUrl(tab?.url) || isTourPracticeUrl(tab?.pendingUrl);
  } catch {
    return false;
  }
}

/**
 * Opens the practice page in a background tab (the popup stays open) and resolves with the new
 * tab's id, or `null` when the browser refused. Never throws.
 */
export async function openTourPracticeTab(): Promise<number | null> {
  const url = tourPracticeTabUrl();
  if (!url) return null;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    return typeof tab?.id === 'number' ? tab.id : null;
  } catch {
    return null;
  }
}

/** Closes the tab with this id, but only while it still shows the practice page. Never throws. */
export async function closeTourPracticeTab(tabId: number | null | undefined): Promise<void> {
  if (typeof tabId !== 'number') return;
  if (!(await isTourPracticeTabOpen(tabId))) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already gone
  }
}
