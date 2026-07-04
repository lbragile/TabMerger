import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Group, Window, Tab } from '@/lib/types';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { getFaviconUrl } from '@/lib/utils';
import { GROUPS_QUERY_KEY } from './useGroups';

function chromeTabToTab(t: chrome.tabs.Tab): Tab {
  return {
    id: t.id ?? 0,
    title: t.title ?? 'Untitled',
    url: t.url ?? '',
    favIconUrl: t.favIconUrl || getFaviconUrl(t.url ?? ''),
    pinned: t.pinned
  };
}

function chromeWindowToWindow(
  w: chrome.windows.Window,
  tabs: chrome.tabs.Tab[]
): Window {
  return {
    id: w.id ?? 0,
    tabs: tabs.map(chromeTabToTab),
    incognito: w.incognito,
    focused: w.focused,
    starred: false,
    name: 'Window'
  };
}

async function syncNowOpen(): Promise<void> {
  try {
    const [chromeWindows, state] = await Promise.all([
      chrome.windows.getAll({ populate: true }),
      getGroupsState()
    ]);

    const nowOpenWindows: Window[] = chromeWindows
      .filter((w) => w.type === 'normal')
      .map((w) => chromeWindowToWindow(w, w.tabs ?? []));

    const available = [...state.available];
    const nowOpenIdx = available.findIndex((g) => g.permanent);
    if (nowOpenIdx === -1) return;

    available[nowOpenIdx] = {
      ...available[nowOpenIdx],
      windows: nowOpenWindows,
      updatedAt: Date.now(),
      pendingSync: false // don't sync the "Now Open" group
    };

    const tabCount = nowOpenWindows.reduce((a, w) => a + w.tabs.length, 0);
    available[nowOpenIdx].info = `${tabCount}T | ${nowOpenWindows.length}W`;

    const next = { ...state, available };
    await saveGroupsState(next);
    return;
  } catch (err) {
    console.error('[useCurrentTabs] sync error', err);
  }
}

export function useCurrentTabs() {
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;

    const doSync = async () => {
      await syncNowOpen();
      if (mounted) {
        qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
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
