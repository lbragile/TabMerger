import { TOUR_DEMO_GROUP_IDS, TOUR_DEMO_GROUP_NAME, TOUR_DEMO_MAIN_ID, TOUR_DEMO_TARGET_GROUP_NAME, TOUR_DEMO_TARGET_ID, isTourDemoGroup } from '@tabmerger/shared';
import { updateGroupsState } from './localDb';
import type { Group, GroupsState, Tab, Window } from './types';
import { getGroupInfo } from './utils';

/**
 * The guided tour's practice data: two groups the tour's "try it" steps work on (dragging,
 * saving and reopening tabs, tidying, selecting, searching, undoing), so nothing of the user's
 * is touched.
 *
 * They are ordinary groups in the local list, marked `tourDemo: true`. Everything that reads
 * saved groups asks `isTourDemoGroup` (from `@tabmerger/shared`) and leaves them out: cloud sync
 * (push, positions, pending remote deletes, the merge), backups, sessions, export, sharing, plan
 * limits, the right-click menu, URL rules, the user's undo history and search (except during the
 * tour's own search steps: `isHiddenFromSearch` in `tourSandbox.ts`). Drag and drop treats
 * them as a sealed sandbox (`canDrop` in `dndMove.ts`): practice items only move between
 * practice groups, and nothing else can be dropped into one.
 *
 * Lifetime: they exist only while a step of one of the chapters that use them is on screen
 * (`TOUR_DEMO_CHAPTERS` in `tour.ts`). `Tour.tsx` makes them on entering those chapters and
 * removes them on leaving, however the tour is left (Next, Back, a skipped chapter, a finished
 * or skipped tour). A popup closed in the middle of such a chapter cannot clean up, so the next
 * popup open does: unless the tour is about to resume there, they are removed before anything
 * else (`Tour.tsx`).
 *
 * The ids are fixed, so a practice group can always be found again (and is also recorded in the
 * tour's stored record). The sample addresses are reserved example domains; the tour never
 * opens them.
 */
export { TOUR_DEMO_MAIN_ID, TOUR_DEMO_TARGET_ID, TOUR_DEMO_GROUP_IDS };
/** Name of the first window of "Tour demo". The step text names it, so a step that does checks it is still there. */
export const TOUR_DEMO_FIRST_WINDOW_NAME = 'Reading';

const sampleTab = (title: string, url: string, savedAt: number): Tab => ({ id: 0, title, url, savedAt });
const sampleWindow = (name: string, tabs: Tab[]): Window => ({ id: 0, name, tabs, incognito: false, focused: false });

/** Fresh copies of the two practice groups, in list order. */
export function buildTourDemoGroups(now: number = Date.now()): Group[] {
  const group = (id: string, name: string, color: string, windows: Window[]): Group => {
    const made: Group = { id, name, color, updatedAt: now, windows, permanent: false, pendingSync: false, tourDemo: true };
    return { ...made, info: getGroupInfo(made) };
  };
  return [
    group(TOUR_DEMO_MAIN_ID, TOUR_DEMO_GROUP_NAME, 'rgba(245,146,30,1)', [
      sampleWindow(TOUR_DEMO_FIRST_WINDOW_NAME, [
        sampleTab('Sample: news article', 'https://example.com/news', now),
        sampleTab('Sample: recipe', 'https://example.com/recipe', now),
        sampleTab('Sample: travel guide', 'https://example.com/travel', now)
      ]),
      sampleWindow('Shopping', [
        sampleTab('Sample: shoes', 'https://example.org/shoes', now),
        sampleTab('Sample: books', 'https://example.org/books', now),
        // The same page twice, on purpose and in ONE window: something for "Deduplicate tabs"
        // to find, without confusing the drag steps (they tell tabs apart by address, per window)
        sampleTab('Sample: books', 'https://example.org/books', now)
      ])
    ]),
    group(TOUR_DEMO_TARGET_ID, TOUR_DEMO_TARGET_GROUP_NAME, 'rgba(0,163,204,1)', [
      sampleWindow('Later', [sampleTab('Sample: weather', 'https://example.net/weather', now)])
    ])
  ];
}

/**
 * True for a group that is practice data: by its flag, or by one of the two fixed ids. Never by
 * an id read from storage: a stored value must not be able to name a group of the user's.
 */
export function isTourDemoEntry(group: Pick<Group, 'id' | 'tourDemo' | 'permanent'>): boolean {
  if (group.permanent) return false;
  return isTourDemoGroup(group) || TOUR_DEMO_GROUP_IDS.includes(group.id);
}

/** The state with both practice groups in it, or `null` when they are already there (no write). */
export function withTourDemoGroups(state: GroupsState, now: number = Date.now()): GroupsState | null {
  const have = new Set(state.available.map((g) => g.id));
  if (TOUR_DEMO_GROUP_IDS.every((id) => have.has(id))) return null;
  // A half-made or damaged set is replaced as a whole
  const rest = state.available.filter((g) => !isTourDemoEntry(g));
  return { ...state, available: [...rest, ...buildTourDemoGroups(now)] };
}

/**
 * The state without any practice group, or `null` when there is none (no write). `active` is
 * moved to "Now Open" when it pointed at a group that is going away.
 */
export function withoutTourDemo(state: GroupsState): GroupsState | null {
  const available = state.available.filter((g) => !isTourDemoEntry(g));
  if (available.length === state.available.length) return null;
  const index = available.findIndex((g) => g.id === state.active?.id);
  const active = index === -1 ? { id: available[0]?.id ?? '', index: 0 } : { id: state.active.id, index };
  return { ...state, active, available };
}

/**
 * Adds the practice groups at the end of the list (after every group of the user's, so no real
 * group changes place). One atomic step of the groups write queue. Resolves with the state
 * after it; `changed` says whether anything was written.
 */
export async function ensureTourDemoGroups(): Promise<{ state: GroupsState; changed: boolean }> {
  let changed = false;
  const state = await updateGroupsState((current) => {
    const next = withTourDemoGroups(current);
    changed = next !== null;
    return next;
  });
  return { state, changed };
}

/** Replaces whatever practice data there is with a fresh set (a step whose sample tabs were used up). */
export async function resetTourDemoGroups(): Promise<{ state: GroupsState; changed: boolean }> {
  const state = await updateGroupsState((current) => {
    const rest = current.available.filter((g) => !isTourDemoEntry(g));
    return { ...current, available: [...rest, ...buildTourDemoGroups()] };
  });
  return { state, changed: true };
}

/**
 * Removes every practice group. No confirmation, no undo entry, and no remote delete is queued
 * (the write path never records one for practice data). Safe to call when there is none.
 */
export async function removeTourDemoGroups(): Promise<{ state: GroupsState; changed: boolean }> {
  let changed = false;
  const state = await updateGroupsState((current) => {
    const next = withoutTourDemo(current);
    changed = next !== null;
    return next;
  });
  return { state, changed };
}
