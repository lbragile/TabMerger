import { nanoid } from 'nanoid';
import { isTourDemoGroup } from '@tabmerger/shared';
import type { Group, GroupsState, Tab, Window } from '@/lib/types';
import { createGroup, createWindow, getGroupInfo, sortWindowsByStarred } from '@/lib/utils';
import { copyLiveTab } from '@/lib/dndMove';
import { getSidebarDisplayOrder } from '@/lib/sidebarOrder';
import { isSameGroupName } from '@/lib/aiGroupName';

/** One Auto-group suggestion from `/api/ai/group-tabs`: a group name, a colour and the Now Open tab ids it holds. */
export interface AiGroupSuggestion {
  name: string;
  color: string;
  tabIds: number[];
}

/** What applying a reply did, and the state it leads to. */
export interface AiApplyResult {
  nextAvailable: Group[];
  /** New saved groups. Only these use up a Free-tier group slot. */
  createdGroups: number;
  /** Existing saved groups the tabs went into, because a suggestion had their name. */
  mergedGroups: number;
  /** Tabs stored. A tab whose URL its target group already has is not stored again. */
  appliedTabs: number;
}

/** Two names are the same group name when they match trimmed and ignoring case. */
function sameName(a: string, b: string): boolean {
  return isSameGroupName(a.trim(), b.trim());
}

/**
 * The index (in `available`) of the saved group an Auto-group suggestion named `name` goes into
 * instead of making a new group, or -1. Only groups shown in the sidebar's group list qualify: not
 * Now Open or any permanent group, not archived, not a guided-tour practice group. Names match
 * trimmed and ignoring case; with several matches the first in sidebar order wins (starred first).
 */
export function findAiMergeTarget(available: Group[], name: string): number {
  if (!name.trim()) return -1;
  const match = getSidebarDisplayOrder(available).find(
    ({ group }) => !group.permanent && !group.archived && !isTourDemoGroup(group) && sameName(group.name, name)
  );
  return match ? match.realIndex : -1;
}

/**
 * Cuts a reply down to the Free-tier group slots left, the same way the apply counts them: a
 * suggestion that goes into an existing group, or repeats the name of one already kept, needs no
 * slot and is always kept; the others are kept while `slots` lasts. `skipped` is how many groups
 * were left out (a skipped name repeated in the reply counts once).
 */
export function clampAiSuggestionsToSlots<T extends AiGroupSuggestion>(
  available: Group[],
  suggestions: T[],
  slots: number
): { kept: T[]; skipped: number } {
  const keptNew: string[] = [];
  const skippedNew: string[] = [];
  const kept = suggestions.filter((s) => {
    if (findAiMergeTarget(available, s.name) >= 0 || keptNew.some((n) => sameName(n, s.name))) return true;
    if (keptNew.length < slots) {
      keptNew.push(s.name);
      return true;
    }
    if (!skippedNew.some((n) => sameName(n, s.name))) skippedNew.push(s.name);
    return false;
  });
  return { kept, skipped: skippedNew.length };
}

/** The tabs headed for one group during an apply. */
interface Target {
  /** Index in `available`, or -1 for a group this apply creates. */
  index: number;
  /** The new group, when `index` is -1. */
  created?: Group;
  /** URLs already in the group, plus the ones added so far. */
  urls: Set<string>;
  tabs: Tab[];
}

/**
 * Applies an Auto-group reply to `prev` (pure: also run against the cached state as the Free-tier
 * precheck). Each suggestion's tabs leave Now Open (matched by real tab id) as detached saved
 * copies. They go into the existing saved group with the same name (`findAiMergeTarget`) as one new
 * window, skipping any tab whose URL that group already has; with no such group they make a new
 * group. Suggestions sharing a name in one reply share one group and one window. A skipped tab
 * still leaves Now Open: only its duplicate copy isn't stored.
 *
 * Now Open never ends up with zero windows (other code assumes `windows[0]` exists): if every
 * window empties out, one empty window stays.
 */
export function applyAiSuggestionsToState(prev: GroupsState, suggestions: AiGroupSuggestion[]): AiApplyResult {
  const available = [...prev.available];
  const nowOpen = { ...available[0] };
  let windows = nowOpen.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));
  const targets: Target[] = [];

  for (const suggestion of suggestions) {
    const idSet = new Set(suggestion.tabIds);
    const movedTabs: Tab[] = [];
    windows = windows.map((w) => {
      movedTabs.push(...w.tabs.filter((t) => idSet.has(t.id)).map((t) => copyLiveTab(t)));
      return { ...w, tabs: w.tabs.filter((t) => !idSet.has(t.id)) };
    });
    if (movedTabs.length === 0) continue;

    const index = findAiMergeTarget(available, suggestion.name);
    let target =
      index >= 0
        ? targets.find((tg) => tg.index === index)
        : targets.find((tg) => tg.created && sameName(tg.created.name, suggestion.name));
    if (!target) {
      target =
        index >= 0
          ? { index, urls: new Set(available[index].windows.flatMap((w) => w.tabs.map((t) => t.url))), tabs: [] }
          : { index: -1, created: createGroup(nanoid(10), suggestion.name, suggestion.color), urls: new Set(), tabs: [] };
      targets.push(target);
    }
    // A brand-new group keeps every tab of its first suggestion, as before; anything added after
    // that (into an existing group, or under a repeated name) skips URLs the group already holds.
    const dedupe = target.index >= 0 || target.tabs.length > 0;
    for (const tab of movedTabs) {
      if (dedupe && target.urls.has(tab.url)) continue;
      target.urls.add(tab.url);
      target.tabs.push(tab);
    }
  }

  const newGroups: Group[] = [];
  let createdGroups = 0;
  let mergedGroups = 0;
  let appliedTabs = 0;
  for (const target of targets) {
    appliedTabs += target.tabs.length;
    if (target.created) {
      const group = target.created;
      group.windows = [createWindow(target.tabs)];
      group.info = getGroupInfo(group);
      newGroups.push(group);
      createdGroups++;
      continue;
    }
    mergedGroups++;
    // Every tab was already there: the group itself doesn't change
    if (target.tabs.length === 0) continue;
    const existing = available[target.index];
    const nextWindows: Window[] = sortWindowsByStarred([...existing.windows, createWindow(target.tabs)]);
    const group: Group = { ...existing, windows: nextWindows, updatedAt: Date.now(), pendingSync: true };
    group.info = getGroupInfo(group);
    available[target.index] = group;
  }

  const finalWindows = windows.filter((w) => w.tabs.length > 0);
  nowOpen.windows = finalWindows.length > 0 ? finalWindows : windows.slice(0, 1);
  available[0] = nowOpen;

  return { nextAvailable: [...available, ...newGroups], createdGroups, mergedGroups, appliedTabs };
}
