/**
 * Close real browser tabs that the popup must NOT close while it is open.
 *
 * Dragging a tab out of "Now Open" moves it, so the real tab has to go. But closing the
 * ACTIVE tab of the window the toolbar popup is anchored to makes Chrome dismiss the popup
 * instantly (spec C7) — mid-drop that killed the commit and looked like a crash. So the
 * popup hands those ids to the background service worker over a long-lived port and the
 * worker closes them when the port DISCONNECTS, which is exactly when the popup goes away.
 *
 * Normally that is ONE id per drop at most: the active tab of the popup's own window
 * (`partitionClosableTabs` in `useDndHandlers.ts`). Tabs of every other window, active or
 * not, are closed by the popup at the drop and never come here. Only when the popup can't
 * tell which window it is in does every dragged active tab get queued instead.
 *
 * Why a port and not a delayed message:
 *  - `onDisconnect` is the only signal that fires for EVERY way a popup can vanish
 *    (Escape, click-away, opening another popup, navigating), not just a tidy close.
 *  - An open port keeps the MV3 worker alive, so the close cannot be lost to worker
 *    eviction in the gap.
 *  - A timer would either fire while the popup is still open (dismissing it — the bug) or
 *    outlive the worker.
 *
 * Failure mode if the extension is reloaded or crashes before the popup closes: the tab
 * stays open. That is strictly better than dismissing the popup, and the destination group
 * already holds the persisted copy either way (persistence precedes side effects).
 */

/** Port name; the background worker matches on it. */
export const DEFERRED_CLOSE_PORT = 'tm-close-tabs-on-popup-close';

/** Message the popup posts down the port. */
export interface DeferredCloseMessage {
  tabIds: number[];
}

let port: chrome.runtime.Port | null = null;

/**
 * Queue `tabIds` to be closed once this popup closes. Safe to call repeatedly: one port is
 * reused for the popup's lifetime, and the worker accumulates ids across messages.
 */
export function closeTabsWhenPopupCloses(tabIds: number[]): void {
  if (tabIds.length === 0) return;
  if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
  try {
    if (!port) {
      port = chrome.runtime.connect({ name: DEFERRED_CLOSE_PORT });
      // A disconnect from the worker's side (reload/eviction) must not leave a dead port
      // cached — the next call reconnects.
      port.onDisconnect.addListener(() => {
        port = null;
      });
    }
    port.postMessage({ tabIds } satisfies DeferredCloseMessage);
  } catch {
    // Worker unreachable: the tab stays open. Never throw into the drop commit.
    port = null;
  }
}

/** Test seam — drops the cached port so a fresh `chrome` stub is picked up. */
export function resetDeferredClosePort(): void {
  port = null;
}
