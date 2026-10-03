import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupsState, Window, Tab } from '@/lib/types';
import { updateGroupsState } from '@/lib/localDb';
import { getFaviconUrl, formatGroupCounts, sortWindowsByStarred } from '@/lib/utils';
import { pushDeviceSession } from '@/lib/deviceSessions';
import { GROUPS_QUERY_KEY } from './useGroups';
import { useEntitlements } from './useEntitlements';

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
  groupMap: Map<number, chrome.tabGroups.TabGroup>,
  starred: boolean
): Window {
  return {
    id: w.id ?? 0,
    tabs: tabs.map((t) => chromeTabToTab(t, groupMap)),
    incognito: w.incognito,
    focused: w.focused,
    starred,
    name: 'Window'
  };
}

/**
 * Rebuilds the Now Open group from live Chrome windows/tabs and persists it to IndexedDB.
 * Carries previously-fetched `ogImage` and `note` values forward so they survive re-syncs.
 * Strips the extension's own popup page from Now Open. Returns the updated `GroupsState`,
 * or `undefined` on error or if there is no permanent group in IDB.
 *
 * The chrome.* queries (macrotask gaps) run BEFORE the write; the groups state is then read
 * fresh and rewritten inside one `updateGroupsState`, so a save/edit that landed while the
 * queries were in flight is kept instead of being overwritten with a pre-query snapshot.
 */
async function syncNowOpen(): Promise<GroupsState | undefined> {
  try {
    const tabGroupsAvailable = typeof chrome.tabGroups?.query === 'function';
    // Use chrome.tabs.query({}) instead of windows.getAll({ populate: true }) — the latter
    // does not reliably include groupId on returned tab objects; tabs.query always does.
    const [chromeTabs, chromeWindows, rawTabGroups] = await Promise.all([
      chrome.tabs.query({}),
      chrome.windows.getAll(),
      tabGroupsAvailable ? chrome.tabGroups.query({}) : Promise.resolve([] as chrome.tabGroups.TabGroup[])
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

    let wrote = false;
    const next = await updateGroupsState((state) => {
      // Carry over previously-set starred flag + relative order so drag/star actions on
      // Now Open windows survive the next tab event instead of being wiped by the rebuild below.
      const prevNowOpen = state.available.find((g) => g.permanent);
      const prevStarredById = new Map<number, boolean>();
      const prevOrderById = new Map<number, number>();
      prevNowOpen?.windows.forEach((w, i) => {
        prevStarredById.set(w.id, w.starred ?? false);
        prevOrderById.set(w.id, i);
      });

      let nowOpenWindows: Window[] = chromeWindows
        .filter((w) => w.type === 'normal' && w.id !== undefined)
        .map((w) => chromeWindowToWindow(w, tabsByWindow.get(w.id!) ?? [], groupMap, prevStarredById.get(w.id!) ?? false))
        .filter((w) => w.tabs.length > 0);

      // Preserve prior relative order (new windows fall to the end of their zone), then
      // re-clamp into starred/unstarred zones — both sorts are stable.
      nowOpenWindows = nowOpenWindows
        .slice()
        .sort((a, b) => (prevOrderById.get(a.id) ?? Infinity) - (prevOrderById.get(b.id) ?? Infinity));
      nowOpenWindows = sortWindowsByStarred(nowOpenWindows);

      // Carry over previously-fetched ogImages (and notes) so they survive re-syncs.
      const prevOgImages = new Map<string, string>();
      const prevNotes = new Map<string, string>();
      prevNowOpen?.windows.forEach((w) => w.tabs.forEach((t) => {
        if (t.ogImage) prevOgImages.set(t.url, t.ogImage);
        if (t.note) prevNotes.set(t.url, t.note);
      }));

      nowOpenWindows.forEach((w) => w.tabs.forEach((t) => {
        if (prevOgImages.has(t.url)) t.ogImage = prevOgImages.get(t.url);
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
      if (nowOpenIdx === -1) return null; // no permanent group in IDB: nothing to write

      available[nowOpenIdx] = {
        ...available[nowOpenIdx],
        windows: nowOpenWindows,
        updatedAt: Date.now(),
        pendingSync: false // don't sync the "Now Open" group
      };

      const tabCount = nowOpenWindows.reduce((a, w) => a + w.tabs.length, 0);
      available[nowOpenIdx].info = formatGroupCounts(nowOpenWindows.length, tabCount);

      wrote = true;
      return { ...state, available };
    });
    return wrote ? next : undefined;
  } catch (err) {
    console.error('[useCurrentTabs] sync error', err);
  }
}

/**
 * Keeps the Now Open group (index 0) in sync with live Chrome tabs.
 * Runs an initial sync on mount (with ogImage backfill), then re-syncs on every
 * tabs/windows Chrome event. Cleans up all listeners on unmount.
 * Must be mounted exactly once — typically at the popup root.
 */
export function useCurrentTabs() {
  const qc = useQueryClient();
  const { tier } = useEntitlements();

  // ponytail: doSync's effect below intentionally has a stable [qc] dep array so the 8
  // chrome.tabs/windows listeners aren't torn down/re-registered on every entitlements
  // poll (useEntitlements refetches every 30s). tierRef lets doSync read the CURRENT tier
  // without needing `tier` in that effect's deps — closing over `tier` directly previously
  // froze it at 'free' (the first-render value, before the subscription query resolves) for
  // the lifetime of the popup, silently breaking device-session pushes for every user, always.
  const tierRef = useRef(tier);
  useEffect(() => {
    tierRef.current = tier;
  }, [tier]);

  useEffect(() => {
    let mounted = true;

    const doSync = async () => {
      const next = await syncNowOpen();
      if (!mounted || !next) return;
      qc.setQueryData(GROUPS_QUERY_KEY, next);
      // ponytail: pushDeviceSession no-ops for free tier internally (and debounce-schedules
      // cheaply either way), so no extra guard needed here — see deviceSessions.ts doPush().
      pushDeviceSession(next, tierRef.current);
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
