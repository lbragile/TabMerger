import { nanoid } from 'nanoid';
import type { ClosedTab, RecentlyClosedEntry } from '@/lib/recentlyClosed';
import type { Group, GroupsState, Tab } from '@/lib/types';
import { createGroup, createWindow, getGroupInfo } from '@/lib/utils';

/**
 * "Save to group…" for recently-closed entries: the pure part (what the saved data looks like
 * afterwards). The write itself is `useSaveClosedToGroup` in hooks/useGroups.ts, so the Free
 * limits, `pendingSync`, sync, encryption and undo work as for every other save.
 */

/** Where the entries go: an existing saved group (by id), or a new group with this name. */
export type ClosedSaveTarget = { groupId: string } | { newGroupName: string };

/** A closed tab as a saved tab: `id: 0` (saved tabs have no browser id), no pin, stamped `savedAt`. */
export function savedTabFromClosed(tab: ClosedTab, now: number): Tab {
  return { id: 0, title: tab.title, url: tab.url, ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}), savedAt: now };
}

/** How many tabs saving these entries adds (for the Free tab limit). */
export function closedTabCount(entries: readonly Pick<RecentlyClosedEntry, 'tabs'>[]): number {
  return entries.reduce((n, e) => n + e.tabs.length, 0);
}

/**
 * The site a new group is named after: the first entry's host without `www.` ("github.com").
 * Empty when the address can't be read (the caller falls back to the default group name).
 */
export function siteGroupName(entries: readonly Pick<RecentlyClosedEntry, 'tabs'>[]): string {
  const url = entries[0]?.tabs[0]?.url;
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The saved data with `entries` added to `target`, or `null` when there is nothing to do (no tabs,
 * or the group is gone, archived or Now Open). Window entries become one window each; tab entries
 * go together into the group's last window (a new window when the group has none, or when window
 * entries are saved with them, so the tabs closed one by one stay together).
 */
export function addClosedEntriesToState(
  state: GroupsState,
  entries: readonly Pick<RecentlyClosedEntry, 'kind' | 'tabs'>[],
  target: ClosedSaveTarget,
  now: number
): { state: GroupsState; groupId: string } | null {
  if (closedTabCount(entries) === 0) return null;
  const available = [...state.available];
  let index: number;
  if ('groupId' in target) {
    index = available.findIndex((g) => g.id === target.groupId && !g.permanent && !g.archived);
    if (index < 0) return null;
  } else {
    available.push(createGroup(nanoid(10), target.newGroupName || undefined));
    index = available.length - 1;
  }

  const singles = entries.filter((e) => e.kind !== 'window').flatMap((e) => e.tabs.map((tab) => savedTabFromClosed(tab, now)));
  const windows = entries.filter((e) => e.kind === 'window' && e.tabs.length > 0).map((e) => createWindow(e.tabs.map((tab) => savedTabFromClosed(tab, now))));

  const group: Group = { ...available[index] };
  const groupWindows = [...group.windows];
  if (singles.length > 0) {
    const last = groupWindows[groupWindows.length - 1];
    if (last && windows.length === 0) groupWindows[groupWindows.length - 1] = { ...last, tabs: [...last.tabs, ...singles] };
    else groupWindows.push(createWindow(singles));
  }
  groupWindows.push(...windows);
  group.windows = groupWindows;
  group.updatedAt = now;
  group.pendingSync = true;
  group.info = getGroupInfo(group);
  available[index] = group;
  return { state: { ...state, available }, groupId: group.id };
}
