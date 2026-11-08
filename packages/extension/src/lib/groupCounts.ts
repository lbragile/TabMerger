import type { Group } from '@/lib/types';
import { isTourDemoGroup } from '@tabmerger/shared';

/**
 * Group and tab counting for the Free plan's limits. No React, no toast, no chrome.*: the
 * background worker (auto-save) counts with the same rule as every popup gate.
 */

/** The groups that count towards a plan's limits: see {@link countSavedGroupsAndTabs}. */
export function countedGroups<T extends { permanent?: boolean; tourDemo?: boolean }>(groups: readonly T[]): T[] {
  return groups.filter((g) => !g.permanent && !isTourDemoGroup(g));
}

/**
 * Counts groups/tabs the way every existing Free-tier gate in the UI does (SidePanel,
 * Header, GroupContextMenu, CreateGroupMenuItem, UpgradeCTA): every non-permanent group
 * counts, INCLUDING archived ones — archiving a group doesn't free up a slot. Only the
 * permanent "Now Open" group (index 0) is excluded, and the guided tour's practice groups, which
 * are not the user's (so a Free user at the limit can still take the tour).
 */
export function countSavedGroupsAndTabs(groups: Group[]): { groups: number; tabs: number } {
  const saved = countedGroups(groups);
  // ponytail: `?? []` guards malformed/partial group objects (e.g. a test fixture or a
  // hand-edited import file missing `windows`) — counting should never throw.
  const tabs = saved.reduce((sum, g) => sum + (g.windows ?? []).reduce((ws, w) => ws + (w.tabs?.length ?? 0), 0), 0);
  return { groups: saved.length, tabs };
}
