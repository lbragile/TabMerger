import { getGroupsState, saveGroupsState, getSetting } from '@/lib/localDb';
import { matchUrlToRule } from '@/hooks/useUrlRules';
import type { UrlRule } from '@/lib/types';
import type { Tab } from '@/lib/types';

export async function applyUrlRule(
  tab: chrome.tabs.Tab,
  matchedGroupId: string | null
): Promise<void> {
  if (!matchedGroupId) return;

  const state = await getGroupsState();
  const group = state.available.find((g) => g.id === matchedGroupId);
  if (!group) return;

  const newTab: Tab = {
    id: tab.id ?? 0,
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl ?? '',
  };

  // Add to the first window, or create one if none exist
  const windows = group.windows.length
    ? group.windows.map((w, i) =>
        i === 0 ? { ...w, tabs: [...w.tabs, newTab] } : w
      )
    : [{ id: Date.now(), tabs: [newTab], incognito: false, focused: false }];

  const updatedState = {
    ...state,
    available: state.available.map((g) =>
      g.id === matchedGroupId ? { ...g, windows, updatedAt: Date.now() } : g
    ),
  };

  await saveGroupsState(updatedState);
}

/** Convenience for background.ts — reads rules from settings store */
export async function getAllUrlRules(): Promise<UrlRule[]> {
  return getSetting<UrlRule[]>('urlRules', []);
}

export { matchUrlToRule };
