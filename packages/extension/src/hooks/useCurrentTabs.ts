import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Group, GroupsState, Window, Tab } from '@/lib/types';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { getFaviconUrl, formatGroupCounts } from '@/lib/utils';
import { GROUPS_QUERY_KEY } from './useGroups';

export function chromeTabToTab(t: chrome.tabs.Tab, groupMap: Map<number, chrome.tabGroups.TabGroup>): Tab {
  const tab: Tab = {
    id: t.id ?? 0,
    title: t.title ?? 'Untitled',
    url: t.url ?? '',
    favIconUrl: t.favIconUrl || getFaviconUrl(t.url ?? ''),
    pinned: t.pinned
  };
  if (t.groupId !== undefined && t.groupId !== -1) {
    const group = groupMap.get(t.groupId);
    if (group) {
      tab.chromeGroup = { id: group.id, name: group.title ?? '', color: group.color };
    }
  }
  return tab;
}

function chromeWindowToWindow(
  w: chrome.windows.Window,
  tabs: chrome.tabs.Tab[],
  groupMap: Map<number, chrome.tabGroups.TabGroup>
): Window {
  return {
    id: w.id ?? 0,
    tabs: tabs.map((t) => chromeTabToTab(t, groupMap)),
    incognito: w.incognito,
    focused: w.focused,
    starred: false,
    name: 'Window'
  };
}

async function syncNowOpen(): Promise<GroupsState | undefined> {
  try {
    const tabGroupsAvailable = typeof chrome.tabGroups?.query === 'function';
    // Use chrome.tabs.query({}) instead of windows.getAll({ populate: true }) — the latter
    // does not reliably include groupId on returned tab objects; tabs.query always does.
    const [chromeTabs, chromeWindows, rawTabGroups, state] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll(),
      tabGroupsAvailable ? chrome.tabGroups.query({}) : Promise.resolve([] as chrome.tabGroups.TabGroup[]),
      getGroupsState()
    ]);

    const groupMap = new Map<number, chrome.tabGroups.TabGroup>(
      rawTabGroups.map((g) => [g.id, g])
    );

    // Group tabs by windowId (tabs.query guarantees groupId is populated)
    const tabsByWindow = new Map<number, chrome.tabs.Tab[]>();
    for (const tab of chromeTabs) {
      if (tab.windowId === undefined) continue;
      const list = tabsByWindow.get(tab.windowId) ?? [];
      list.push(tab);
      tabsByWindow.set(tab.windowId, list);
    }

    const nowOpenWindows: Window[] = chromeWindows
      .filter((w) => w.type === 'normal' && w.id !== undefined)
      .map((w) => chromeWindowToWindow(w, tabsByWindow.get(w.id!) ?? [], groupMap));

    // Guard: strip any extra permanent groups beyond the first one
    let seenPermanent = false;
    const available = state.available.filter((g) => {
      if (!g.permanent) return true;
      if (!seenPermanent) { seenPermanent = true; return true; }
      return false;
    });
    const nowOpenIdx = available.findIndex((g) => g.permanent);
    if (nowOpenIdx === -1) return;

    available[nowOpenIdx] = {
      ...available[nowOpenIdx],
      windows: nowOpenWindows,
      updatedAt: Date.now(),
      pendingSync: false // don't sync the "Now Open" group
    };

    const tabCount = nowOpenWindows.reduce((a, w) => a + w.tabs.length, 0);
    available[nowOpenIdx].info = formatGroupCounts(nowOpenWindows.length, tabCount);

    const next = { ...state, available };
    await saveGroupsState(next);
    return next;
  } catch (err) {
    console.error('[useCurrentTabs] sync error', err);
  }
}

export function useCurrentTabs() {
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;

    const doSync = async () => {
      const next = await syncNowOpen();
      if (mounted && next) {
        qc.setQueryData(GROUPS_QUERY_KEY, next);
      }
    };

    void doSync();

    const handleChange = () => void doSync();

    chrome.tabs.onCreated.addListener(handleChange);
    chrome.tabs.onRemoved.addListener(handleChange);
    chrome.tabs.onUpdated.addListener(handleChange);
    chrome.tabs.onMoved.addListener(handleChange);
    chrome.tabs.onDetached.addListener(handleChange);
    chrome.tabs.onAttached.addListener(handleChange);
    chrome.windows.onCreated.addListener(handleChange);
    chrome.windows.onRemoved.addListener(handleChange);

    return () => {
      mounted = false;
      chrome.tabs.onCreated.removeListener(handleChange);
      chrome.tabs.onRemoved.removeListener(handleChange);
      chrome.tabs.onUpdated.removeListener(handleChange);
      chrome.tabs.onMoved.removeListener(handleChange);
      chrome.tabs.onDetached.removeListener(handleChange);
      chrome.tabs.onAttached.removeListener(handleChange);
      chrome.windows.onCreated.removeListener(handleChange);
      chrome.windows.onRemoved.removeListener(handleChange);
    };
  }, [qc]);
}
