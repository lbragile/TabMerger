import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupsState, Window, Tab } from '@/lib/types';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { getFaviconUrl, formatGroupCounts } from '@/lib/utils';
import { GROUPS_QUERY_KEY } from './useGroups';

/**
 * Converts a raw `chrome.tabs.Tab` to the app's `Tab` type.
 * Attaches `chromeGroup` metadata when the tab belongs to a Chrome tab group —
 * the group title and color come from the `groupMap` pre-built by the caller.
 */
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

/** Fetch ogImage for a single live tab via content script. Returns null if unavailable. */
async function fetchOgImageForTab(tabId: number): Promise<string | null> {
  if (!tabId) return null;
  try {
    const meta = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_META' });
    return (meta as { ogImage?: string | null })?.ogImage ?? null;
  } catch {
    return null;
  }
}

/**
 * Rebuilds the Now Open group from live Chrome windows/tabs and persists it to IndexedDB.
 * Carries previously-fetched `ogImage` and `note` values forward so they survive re-syncs.
 * Strips the extension's own popup page from Now Open. Returns the updated `GroupsState`,
 * or `undefined` on error or if there is no permanent group in IDB.
 */
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

    // ponytail: exclude the extension's own pages (e.g. its popup opened as a window/tab)
    // from Now Open — chrome.runtime.id, same "own pages" concept as RESTRICTED_URL_RE
    // in useGroups.ts, but scoped to this extension only rather than all extensions.
    const ownExtensionPrefix = `chrome-extension://${chrome.runtime.id}/`;
    for (const [windowId, tabs] of tabsByWindow) {
      tabsByWindow.set(windowId, tabs.filter((t) => !t.url?.startsWith(ownExtensionPrefix)));
    }

    const nowOpenWindows: Window[] = chromeWindows
      .filter((w) => w.type === 'normal' && w.id !== undefined)
      .map((w) => chromeWindowToWindow(w, tabsByWindow.get(w.id!) ?? [], groupMap))
      .filter((w) => w.tabs.length > 0);

    // Carry over previously-fetched ogImages so they survive re-syncs.
    // Also schedule a background fetch for tabs that don't have one yet.
    const prevNowOpen = state.available.find((g) => g.permanent);
    const prevOgImages = new Map<string, string>();
    const prevNotes = new Map<string, string>();
    prevNowOpen?.windows.forEach((w) => w.tabs.forEach((t) => {
      if (t.ogImage) prevOgImages.set(t.url, t.ogImage);
      if (t.note) prevNotes.set(t.url, t.note);
    }));

    const tabsMissingOgImage: Tab[] = [];
    nowOpenWindows.forEach((w) => w.tabs.forEach((t) => {
      if (prevOgImages.has(t.url)) t.ogImage = prevOgImages.get(t.url);
      else tabsMissingOgImage.push(t);
      if (prevNotes.has(t.url)) t.note = prevNotes.get(t.url);
    }));

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

/** Background pass: fetch ogImages for live Now Open tabs and persist them. */
async function backfillOgImages(
  tabs: Tab[],
  setQueryData: (updater: (prev: GroupsState) => GroupsState) => void
) {
  if (tabs.length === 0) return;
  const results = await Promise.all(
    tabs.map(async (t) => ({ url: t.url, ogImage: await fetchOgImageForTab(t.id ?? 0) }))
  );
  const fetched = new Map(results.filter((r) => r.ogImage).map((r) => [r.url, r.ogImage!]));
  if (fetched.size === 0) return;

  setQueryData((prev) => {
    const available = prev.available.map((g) => {
      if (!g.permanent) return g;
      return {
        ...g,
        windows: g.windows.map((w) => ({
          ...w,
          tabs: w.tabs.map((t) => fetched.has(t.url) ? { ...t, ogImage: fetched.get(t.url) } : t)
        }))
      };
    });
    void saveGroupsState({ ...prev, available });
    return { ...prev, available };
  });
}

/**
 * Keeps the Now Open group (index 0) in sync with live Chrome tabs.
 * Runs an initial sync on mount (with ogImage backfill), then re-syncs on every
 * tabs/windows Chrome event. Cleans up all listeners on unmount.
 * Must be mounted exactly once — typically at the popup root.
 */
export function useCurrentTabs() {
  const qc = useQueryClient();

  useEffect(() => {
    let mounted = true;

    const doSync = async (fetchOg = false) => {
      const next = await syncNowOpen();
      if (!mounted || !next) return;
      qc.setQueryData(GROUPS_QUERY_KEY, next);
      if (fetchOg) {
        const nowOpen = next.available.find((g) => g.permanent);
        const missing = (nowOpen?.windows ?? []).flatMap((w) =>
          w.tabs.filter((t) => !t.ogImage)
        );
        void backfillOgImages(missing, (updater) =>
          qc.setQueryData(GROUPS_QUERY_KEY, updater)
        );
      }
    };

    // Initial sync fetches ogImages; subsequent event-driven syncs carry them over via prevOgImages.
    void doSync(true);

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
