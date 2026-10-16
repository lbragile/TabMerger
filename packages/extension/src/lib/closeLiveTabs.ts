import { closeTabsWhenPopupCloses } from '@/lib/deferredTabClose';

/**
 * Id of the browser window this TabMerger page lives in, or `null` when it can't be told.
 *
 * `chrome.windows.getCurrent()` resolves to the window containing the calling page, not
 * the focused one: for the toolbar popup that is the window it is anchored to, and for
 * `popup.html` opened as an ordinary tab it is the window holding that tab. (It must be
 * asked from the page — in a service worker "current" falls back to the last active
 * window. `chrome.tabs.getCurrent()` is no use either: it is `undefined` in a popup.)
 */
async function ownWindowId(): Promise<number | null> {
  try {
    const win = await chrome.windows.getCurrent();
    return typeof win?.id === 'number' && win.id >= 0 ? win.id : null;
  } catch {
    return null;
  }
}

/**
 * Split the tabs a Now Open drag-out wants closed into "safe to close right now" and
 * "must wait until the popup is gone".
 *
 * Closing the ACTIVE tab of the window the toolbar popup is anchored to dismisses the
 * popup instantly (spec C7), so that ONE tab is deferred. Every other tab closes now,
 * active or not: the popup only watches its own window's tab strip, and a dragged window
 * the popup is not attached to is expected to close completely at the drop.
 *
 * If the popup's own window can't be identified — the lookup fails, or it names a window
 * that owns none of the active tabs — every tab that is active in ANY window is deferred
 * instead. Over-deferring costs nothing (the close still happens, just on popup close);
 * under-deferring costs the user their popup mid-drop.
 *
 * Exported for tests; `chrome.tabs.query` failing degrades to "defer everything", which
 * is the safe direction.
 */
export async function partitionClosableTabs(
  tabIds: number[]
): Promise<{ now: number[]; deferred: number[] }> {
  const unique = [...new Set(tabIds)].filter((id) => typeof id === 'number' && id > 0);
  if (unique.length === 0) return { now: [], deferred: [] };
  let held = new Set<number>();
  try {
    const [active, ownId] = await Promise.all([chrome.tabs.query({ active: true }), ownWindowId()]);
    const mine = ownId === null ? [] : active.filter((t) => t.windowId === ownId);
    held = new Set(
      (mine.length > 0 ? mine : active).map((t) => t.id).filter((id): id is number => typeof id === 'number')
    );
  } catch {
    return { now: [], deferred: unique };
  }
  return {
    now: unique.filter((id) => !held.has(id)),
    deferred: unique.filter((id) => held.has(id))
  };
}

/**
 * Close real browser tabs without ever dismissing the popup: everything
 * {@link partitionClosableTabs} says is safe closes now, the popup's own anchor tab is handed to
 * the background worker to close once the popup goes away. Used by a drag OUT of Now Open and by
 * Redo of one (`lib/undoLiveTabs.ts`).
 */
export async function closeLiveTabsSafely(tabIds: number[]): Promise<void> {
  const { now, deferred } = await partitionClosableTabs(tabIds);
  // The deferred ids go first: if removing the others somehow dismisses the popup,
  // the background worker already holds the rest.
  if (deferred.length > 0) closeTabsWhenPopupCloses(deferred);
  if (now.length > 0) await chrome.tabs.remove(now);
}
