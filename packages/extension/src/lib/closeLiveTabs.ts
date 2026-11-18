import { closeTabsWhenPopupCloses } from '@/lib/deferredTabClose';
import { quietCloseTabKey, quietCloseWindowKey } from '@/lib/recentlyClosed';

/**
 * Whether the browser should remember a close in "Recently closed tabs":
 *  - `record: false` when the tab's content is safe elsewhere: it was just saved (moved) into a
 *    group, it is a duplicate whose URL stays open, or it is reopened somewhere else;
 *  - `record: true` when the user only closed it (nothing saved).
 */
export interface CloseOptions {
  record: boolean;
}

/**
 * Marks ids as "closed by TabMerger, don't record" in `chrome.storage.session` (one key per id, so
 * the popup adding marks and the worker consuming them never overwrite each other). Awaited BEFORE
 * the close, so the worker's `onRemoved` always sees the mark. Best effort: without session storage
 * (an old browser) the close is recorded, which only means one extra list entry.
 */
async function markQuiet(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const session = typeof chrome === 'undefined' ? undefined : chrome.storage?.session;
    if (!session?.set) return;
    const at = Date.now();
    await session.set(Object.fromEntries(keys.map((key) => [key, at])));
  } catch {
    // storage unavailable: the close is still made (and recorded)
  }
}

function validIds(ids: number | readonly number[]): number[] {
  const list = typeof ids === 'number' ? [ids] : [...ids];
  return [...new Set(list)].filter((id) => typeof id === 'number' && Number.isInteger(id) && id >= 0);
}

/**
 * THE way TabMerger closes browser tabs (an ESLint rule bans `chrome.tabs.remove` everywhere
 * else): every close states whether "Recently closed tabs" should remember it (see
 * {@link CloseOptions}). Rejects like `chrome.tabs.remove` does (a tab already gone), so callers
 * keep their own `.catch`.
 */
export async function closeTabs(ids: number | readonly number[], { record }: CloseOptions): Promise<void> {
  const list = validIds(ids);
  if (list.length === 0) return;
  if (!record) await markQuiet(list.map(quietCloseTabKey));
  // the call keeps the caller's shape (one id, or a list)
  if (typeof ids === 'number') {
    // eslint-disable-next-line no-restricted-syntax -- the one sanctioned close path (see closeTabs)
    await chrome.tabs.remove(list[0]);
  } else {
    // eslint-disable-next-line no-restricted-syntax -- the one sanctioned close path (see closeTabs)
    await chrome.tabs.remove(list);
  }
}

/**
 * {@link closeTabs} for whole browser windows (`chrome.windows.remove`), with the same rule: a
 * window whose tabs are reopened elsewhere is closed quietly.
 */
export async function closeWindows(ids: number | readonly number[], { record }: CloseOptions): Promise<void> {
  const list = validIds(ids);
  if (list.length === 0) return;
  if (!record) await markQuiet(list.map(quietCloseWindowKey));
  // eslint-disable-next-line no-restricted-syntax -- the one sanctioned close path (see closeTabs)
  await Promise.all(list.map((id) => chrome.windows.remove(id)));
}

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
  // a drag OUT of Now Open moves the tabs into a group (and Redo of one does it again): not recorded
  if (now.length > 0) await closeTabs(now, { record: false });
}
