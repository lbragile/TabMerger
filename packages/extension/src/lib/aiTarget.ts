import type { Group, GroupsState, Tab, Window } from './types';

/**
 * What an AI "Name" or "Describe" action writes to: a saved group (by id), or one window of a saved
 * group. Windows have no id of their own (saved windows are all `id: 0`), so a window is the group's
 * id plus the window's position AND the tabs it held when the request was sent (`tabsKey`): the
 * request takes seconds, and by the reply the window may have moved, been deleted or been changed.
 */
export type AiTarget =
  | { kind: 'group'; groupId: string }
  | { kind: 'window'; groupId: string; windowIndex: number; tabsKey: string };

/** One saved group or window an AI action is about: where the result goes, its name, its tabs. */
export interface AiSubject {
  target: AiTarget;
  /** The current name: sent as `groupName` by Describe, compared with the suggestions by Name. "" when a window has none. */
  name: string;
  tabs: Tab[];
  /** Now Open: it mirrors the browser and is rebuilt from it, so names and notes there don't last. */
  permanent: boolean;
}

/**
 * Why an AI name/note action can't run for a subject: `notSaved` for Now Open (or nothing at all),
 * `noTabs` when there is nothing to work from.
 */
export type AiSubjectBlock = 'notSaved' | 'noTabs';

/** The tabs a window holds, order aside (a sort keeps the same tabs), as one comparable string. */
export function windowTabsKey(window: Pick<Window, 'tabs'>): string {
  return JSON.stringify((window.tabs ?? []).filter(Boolean).map((tab) => tab.url).sort());
}

/** A saved group as an AI subject; `undefined` without a group. */
export function groupSubject(group: Group | undefined): AiSubject | undefined {
  if (!group) return undefined;
  return {
    target: { kind: 'group', groupId: group.id },
    name: group.name,
    tabs: group.windows.flatMap((w) => w.tabs),
    permanent: !!group.permanent
  };
}

/** Window `windowIndex` of `group` as an AI subject; `undefined` when either is missing. */
export function windowSubject(group: Group | undefined, windowIndex: number, window: Window | undefined): AiSubject | undefined {
  if (!group || !window) return undefined;
  return {
    target: { kind: 'window', groupId: group.id, windowIndex, tabsKey: windowTabsKey(window) },
    name: window.name ?? '',
    tabs: window.tabs.filter(Boolean),
    permanent: !!group.permanent
  };
}

/** Why `subject` can't be named or described now, or `null` when it can. */
export function subjectBlock(subject: AiSubject | undefined): AiSubjectBlock | null {
  if (!subject || subject.permanent) return 'notSaved';
  return subject.tabs.length === 0 ? 'noTabs' : null;
}

/** Where an AI target is in the current groups list, with what a write would change. */
export interface ResolvedAiTarget {
  groupIndex: number;
  group: Group;
  /** `null` for a group target */
  windowIndex: number | null;
  window: Window | null;
  /** The current name ("" for an unnamed window) and note ("" when none). */
  name: string;
  note: string;
}

/**
 * Finds `target` in `state` again. A group is found by id. A window is the one at its old position
 * when that one still holds the same tabs, else the only window of the group that does (it moved:
 * starring, a drag, a delete above it); none or several such windows count as changed. `null` when
 * the target is gone or changed, so nothing is written to a window the user didn't pick.
 */
export function resolveAiTarget(state: GroupsState | undefined, target: AiTarget | null): ResolvedAiTarget | null {
  if (!state || !target) return null;
  const groupIndex = state.available.findIndex((g) => g.id === target.groupId);
  if (groupIndex < 0) return null;
  const group = state.available[groupIndex];
  if (target.kind === 'group') {
    return { groupIndex, group, windowIndex: null, window: null, name: group.name, note: group.note ?? '' };
  }
  const windows = group.windows;
  const atPosition = windows[target.windowIndex];
  let windowIndex = -1;
  if (atPosition && windowTabsKey(atPosition) === target.tabsKey) {
    windowIndex = target.windowIndex;
  } else {
    const matches = windows.flatMap((w, i) => (w && windowTabsKey(w) === target.tabsKey ? [i] : []));
    if (matches.length === 1) windowIndex = matches[0];
  }
  if (windowIndex < 0) return null;
  const window = windows[windowIndex];
  return { groupIndex, group, windowIndex, window, name: window.name ?? '', note: window.note ?? '' };
}

/**
 * The modal data a "Describe"/"Name" modal was opened with, read back as a target: `groupId` (a
 * string) for a group, plus `window: { index, tabsKey }` for a window. Malformed window data is
 * `null`, never the group: a broken window target must not end up writing to the whole group.
 * This is the modal's trust boundary (its data is a plain record).
 */
export function readAiTarget(data: Record<string, unknown>): AiTarget | null {
  const groupId = data.groupId;
  if (typeof groupId !== 'string' || !groupId) return null;
  if (data.window === undefined) return { kind: 'group', groupId };
  const raw = data.window;
  if (!raw || typeof raw !== 'object') return null;
  const { index, tabsKey } = raw as { index?: unknown; tabsKey?: unknown };
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || typeof tabsKey !== 'string') return null;
  return { kind: 'window', groupId, windowIndex: index, tabsKey };
}

/** The modal data for `target` (the reverse of `readAiTarget`), merged with `extra`. */
export function aiTargetModalData(target: AiTarget, extra: Record<string, unknown>): Record<string, unknown> {
  return target.kind === 'group'
    ? { groupId: target.groupId, ...extra }
    : { groupId: target.groupId, window: { index: target.windowIndex, tabsKey: target.tabsKey }, ...extra };
}
