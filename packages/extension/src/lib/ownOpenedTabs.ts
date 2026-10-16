/**
 * Real tabs THIS popup just opened itself: a saved item dropped into Now Open, the menu / bulk
 * "move to Now Open", an Undo reopening the tabs a drag-out closed. When the service worker then
 * saves one of them because it matches a URL rule, that save is a consequence of the popup's own
 * action, not a change made elsewhere, so it must not wipe the undo history
 * (`useExternalGroupsChanges`). An Undo of the action restores the state from before it, which
 * removes the rule's copy along with the rest of the action: one Undo reverts the whole operation.
 *
 * The exemption is narrow on purpose, because a stale one is harmful: kept history whose Undo
 * would silently delete a capture the user did not make as part of that action. So it counts only
 *  - ONCE per opened tab (the entry is consumed by the first lookup, used or not),
 *  - within {@link OWN_TAB_WINDOW_MS} of opening it (a capture minutes later, after a reload or
 *    navigation, is a change of its own), and
 *  - for the URL the popup opened (a tab that redirected or was navigated is not it any more).
 *
 * Every opener records the tab the moment Chrome returns its id (before any await), while the
 * worker's save needs a rules read and an IndexedDB transaction before it broadcasts.
 * Module state: it lives as long as the popup page.
 */
export const OWN_TAB_WINDOW_MS = 10_000;

const opened = new Map<number, { url: string; openedAt: number }>();

/** Comparable form of a URL (`https://a.com` and `https://a.com/` are the same page). */
function normalUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

/** Remember tabs this popup opened (ids that are not real tab ids, or without a URL, are skipped). */
export function noteTabsOpenedByPopup(tabs: Iterable<{ id?: number; url?: string }>, now = Date.now()): void {
  for (const { id, url } of tabs) {
    if (typeof id === 'number' && id > 0 && typeof url === 'string' && url !== '') opened.set(id, { url: normalUrl(url), openedAt: now });
  }
}

/**
 * Whether a URL-rule save of `tabId` at `url` is part of this popup's own action. Consumes the
 * entry: a later save of the same tab (a reload, the next navigation) is never exempt.
 */
export function consumeOwnOpenedTab(tabId: number, url: unknown, now = Date.now()): boolean {
  const entry = opened.get(tabId);
  if (!entry) return false;
  opened.delete(tabId);
  return now - entry.openedAt <= OWN_TAB_WINDOW_MS && typeof url === 'string' && normalUrl(url) === entry.url;
}

/** Test seam. */
export function resetOwnOpenedTabs(): void {
  opened.clear();
}
