import { updateGroupsState, getSetting } from '@/lib/localDb';
import { matchUrlToRule } from '@/hooks/useUrlRules';
import type { UrlRule } from '@/lib/types';
import type { Tab } from '@/lib/types';

/**
 * ponytail: no Free-tier gating here, deliberately. `useSaveUrlRules` only blocks CREATING
 * new rules past `maxUrlRules`; rules already saved while on a paid plan keep matching and
 * applying here after a downgrade to Free. Only adding new ones is blocked (UrlRulesModal's
 * "Add" button + the `useSaveUrlRules` backstop), not what's already saved.
 */

/**
 * Appends a newly-opened tab to the matched group in IndexedDB.
 * Does NOT close the tab in Chrome — rule matching is purely additive (the tab stays open).
 * Called by the background script after `matchUrlToRule` returns a non-null groupId.
 */
export async function applyUrlRule(
  tab: chrome.tabs.Tab,
  matchedGroupId: string | null
): Promise<void> {
  if (!matchedGroupId) return;

  const newTab: Tab = {
    id: tab.id ?? 0,
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl ?? '',
    savedAt: Date.now(),
  };

  // Atomic against the popup's writes: this runs in the service worker, a different JS
  // context from the popup, so the read-modify-write must be one `updateGroupsState`.
  await updateGroupsState((state) => {
    const group = state.available.find((g) => g.id === matchedGroupId);
    if (!group) return null;

    // Add to the first window, or create one if none exist
    const windows = group.windows.length
      ? group.windows.map((w, i) =>
          i === 0 ? { ...w, tabs: [...w.tabs, newTab] } : w
        )
      : [{ id: Date.now(), tabs: [newTab], incognito: false, focused: false }];

    return {
      ...state,
      available: state.available.map((g) =>
        g.id === matchedGroupId ? { ...g, windows, updatedAt: Date.now(), pendingSync: true } : g
      ),
    };
  });
}

/** Convenience for background.ts — reads rules from settings store */
export async function getAllUrlRules(): Promise<UrlRule[]> {
  return getSetting<UrlRule[]>('urlRules', []);
}

export { matchUrlToRule };
