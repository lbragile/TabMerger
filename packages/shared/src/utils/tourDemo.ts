/**
 * The guided tour's practice data.
 *
 * While the tour's drag chapter is on screen the extension keeps two "Tour demo" groups in the
 * user's local list, so drag and drop can be tried on data that is not theirs. They are marked
 * with ONE flag, `tourDemo: true`, and {@link isTourDemoGroup} is the ONE test for it: every
 * consumer of saved groups (cloud sync, backups, sessions, export, sharing, plan limits, the
 * right-click menu, URL rules, undo, search, the badge) asks it, so a demo group never leaves
 * the device, never counts towards a plan and never appears outside the tour.
 */

/** Name of the first demo group (two windows of sample tabs). */
export const TOUR_DEMO_GROUP_NAME = 'Tour demo';
/** Name of the second demo group (the place to drop a tab). */
export const TOUR_DEMO_TARGET_GROUP_NAME = 'Tour demo 2';

/** True for a group the guided tour made as practice data. Only the literal `true` counts. */
export function isTourDemoGroup(group: { tourDemo?: unknown } | null | undefined): boolean {
  return group?.tourDemo === true;
}

/** The groups given, without the tour's practice data. Returns the same array when there is none. */
export function withoutTourDemoGroups<T extends { tourDemo?: unknown }>(groups: readonly T[]): T[] {
  return groups.some(isTourDemoGroup) ? groups.filter((g) => !isTourDemoGroup(g)) : (groups as T[]);
}
