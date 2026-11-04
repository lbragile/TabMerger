/**
 * AI "Organize": the actions `POST /api/ai/organize` proposes (`OrganizeAction` in
 * `@tabmerger/shared`), checked as untrusted input and applied to the local groups as one pure
 * transform. The popup's review modal lists them, and `useApplyOrganize` writes the selected ones
 * in ONE groups write (one undo step, one sync push).
 */
import { isTourDemoGroup, type OrganizeAction } from '@tabmerger/shared';
import type { Group, GroupsState, UrlRule } from './types';
import { getGroupInfo, sortWindowsByStarred } from './utils';
import { cleanSuggestedName } from './aiGroupName';

/** Most actions read from one reply: a reply longer than this is runaway output, the rest is dropped. */
export const MAX_ORGANIZE_ACTIONS = 100;

/** Longest id accepted from the reply (`Group.id` is nanoid(10); older ids may be longer). */
const MAX_ID_LENGTH = 64;

/** A group an Organize action may name: a saved group (not Now Open), not the tour's practice data. */
function isOrganizable(group: Group | undefined): group is Group {
  return !!group && !group.permanent && !isTourDemoGroup(group);
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;

/** One reply item as an action on `groups` (by id), or null when it is malformed or would change nothing. */
function parseAction(item: unknown, byId: Map<string, Group>): OrganizeAction | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  switch (raw.type) {
    case 'merge': {
      const { sourceGroupId, targetGroupId } = raw;
      if (!isId(sourceGroupId) || !isId(targetGroupId) || sourceGroupId === targetGroupId) return null;
      const source = byId.get(sourceGroupId);
      const target = byId.get(targetGroupId);
      // Archived groups are left out of merges, as in the AI banner's Merge (useMergeGroups)
      if (!source || !target || source.archived || target.archived) return null;
      return { type: 'merge', sourceGroupId, targetGroupId };
    }
    case 'rename': {
      const group = isId(raw.groupId) ? byId.get(raw.groupId) : undefined;
      const newName = cleanSuggestedName(raw.newName);
      if (!group || !newName || newName === group.name) return null;
      return { type: 'rename', groupId: group.id, newName };
    }
    case 'delete': {
      const group = isId(raw.groupId) ? byId.get(raw.groupId) : undefined;
      if (!group || group.archived) return null;
      return { type: 'delete', groupId: group.id };
    }
    case 'reorder': {
      if (!Array.isArray(raw.groupIds)) return null;
      const ids = [...new Set(raw.groupIds.slice(0, MAX_ORGANIZE_ACTIONS * 10).filter(isId))].filter((id) => {
        const group = byId.get(id);
        return !!group && !group.archived;
      });
      if (ids.length < 2) return null;
      // Only a real change: the listed groups' current relative order differs from the proposed one
      const listed = new Set(ids);
      const current = [...byId.values()].filter((g) => listed.has(g.id)).map((g) => g.id);
      if (current.every((id, i) => id === ids[i])) return null;
      return { type: 'reorder', groupIds: ids };
    }
    default:
      return null;
  }
}

/** Two actions with the same key would act on the same thing twice: only the first is kept. */
function actionKey(action: OrganizeAction): string {
  switch (action.type) {
    case 'merge':
      return `merge:${action.sourceGroupId}`; // a group can be merged away once
    case 'rename':
      return `rename:${action.groupId}`;
    case 'delete':
      return `delete:${action.groupId}`;
    case 'reorder':
      return 'reorder'; // one new order
  }
}

/**
 * The reply of `POST /api/ai/organize` as actions on `groups`. The reply is untrusted (it is AI
 * output passed through our server): anything that is not one of the four action shapes, names an
 * unknown group, Now Open (or any permanent group), an archived group where that makes no sense,
 * or the tour's practice groups is dropped; names are cleaned like "Name group" names; actions
 * that would change nothing (a rename to the same name, a reorder to the current order) and
 * repeats are dropped. At most {@link MAX_ORGANIZE_ACTIONS} reply items are read.
 */
export function sanitizeOrganizeActions(raw: unknown, groups: readonly Group[] | undefined): OrganizeAction[] {
  const list = raw && typeof raw === 'object' ? (raw as { actions?: unknown }).actions : undefined;
  if (!Array.isArray(list) || !groups) return [];
  const byId = new Map(groups.filter(isOrganizable).map((g) => [g.id, g] as const));
  const actions: OrganizeAction[] = [];
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_ORGANIZE_ACTIONS)) {
    const action = parseAction(item, byId);
    if (!action || seen.has(actionKey(action))) continue;
    seen.add(actionKey(action));
    actions.push(action);
  }
  return actions;
}

/** What {@link applyOrganizeActions} did. */
export interface OrganizeResult {
  /** The new state; the very `state` passed in when nothing applied. */
  state: GroupsState;
  /** The actions that changed something, in the order they were applied. */
  applied: OrganizeAction[];
  /** Each merged-away group id → the group that holds its tabs now (chains already followed). */
  mergedInto: Record<string, string>;
  /** Ids of the groups archived by `delete` actions. */
  archivedIds: string[];
}

/**
 * Applies Organize actions to `state` (pure; `now` stamps the changed groups). Everything is
 * addressed by `Group.id` on this state, never by position or `tab.id`.
 *
 * Order, whatever order the actions come in: merges, then renames, then archives, then the
 * reorder. An action whose group is no longer there (or never was) is skipped, so selected
 * actions that collide resolve like this:
 * - merge A into B, then B into C: B's merge carries A's tabs along into C. A merge whose target
 *   was merged away goes to wherever that target went; a source already merged away is skipped
 *   (its tabs already moved), and so is a merge that would land a group in itself.
 * - rename A where A was merged away: skipped (A's tabs now live under the target's name). A rename
 *   of a merge target applies to the merged group.
 * - archive B where B is a merge target: the merged group is archived, tabs included. Nothing is
 *   lost: archiving is reversible (the AI `delete` is never a hard delete). Archive of a group that
 *   was merged away: skipped.
 * - reorder: merged-away and archived groups drop out of it; the remaining listed groups take the
 *   slots they occupy now, in the proposed order. Unlisted groups and Now Open (index 0) stay put.
 *
 * A merge keeps the target's name, colour, note and star; the source's windows go after the
 * target's own (starred windows first) and the source group is removed: the same result as the
 * AI banner's Merge. Changed groups get a fresh `updatedAt` and `pendingSync` like every other
 * mutation; reindexed groups are flagged for a position push by the write itself.
 */
export function applyOrganizeActions(state: GroupsState, actions: readonly OrganizeAction[], now = Date.now()): OrganizeResult {
  let available = [...state.available];
  const applied: OrganizeAction[] = [];
  const merged = new Map<string, string>();
  const archivedIds: string[] = [];
  const indexOf = (id: string) => available.findIndex((g) => g.id === id);
  /** Where a group's tabs are now: follows merges (a cycle can't form, the guard is a backstop). */
  const resolve = (id: string) => {
    let current = id;
    const seen = new Set<string>();
    while (merged.has(current) && !seen.has(current)) {
      seen.add(current);
      current = merged.get(current) as string;
    }
    return current;
  };
  const touched = (group: Group): Group => ({ ...group, updatedAt: now, pendingSync: true });
  const ofType = <T extends OrganizeAction['type']>(type: T) =>
    actions.filter((a): a is Extract<OrganizeAction, { type: T }> => a?.type === type);

  for (const action of ofType('merge')) {
    if (merged.has(action.sourceGroupId)) continue;
    const targetId = resolve(action.targetGroupId);
    if (targetId === action.sourceGroupId) continue;
    const sourceIndex = indexOf(action.sourceGroupId);
    const targetIndex = indexOf(targetId);
    const source = available[sourceIndex];
    const target = available[targetIndex];
    if (!isOrganizable(source) || !isOrganizable(target) || source.archived || target.archived) continue;
    const result = touched({ ...target, windows: sortWindowsByStarred([...target.windows, ...source.windows]) });
    result.info = getGroupInfo(result);
    available[targetIndex] = result;
    available.splice(sourceIndex, 1);
    merged.set(source.id, target.id);
    applied.push(action);
  }

  for (const action of ofType('rename')) {
    const index = indexOf(action.groupId);
    const group = available[index];
    const name = cleanSuggestedName(action.newName);
    if (!isOrganizable(group) || !name || name === group.name) continue;
    available[index] = touched({ ...group, name });
    applied.push(action);
  }

  for (const action of ofType('delete')) {
    const index = indexOf(action.groupId);
    const group = available[index];
    if (!isOrganizable(group) || group.archived) continue;
    available[index] = touched({ ...group, archived: true });
    archivedIds.push(group.id);
    applied.push(action);
  }

  for (const action of ofType('reorder')) {
    if (!Array.isArray(action.groupIds)) continue;
    const ids = [...new Set(action.groupIds)].filter((id) => {
      const group = available[indexOf(id)];
      return isOrganizable(group) && !group.archived;
    });
    if (ids.length < 2) continue;
    const slots = ids.map(indexOf).sort((a, b) => a - b);
    const ordered = ids.map((id) => available[indexOf(id)]);
    if (slots.every((slot, k) => available[slot].id === ordered[k].id)) continue;
    const next = [...available];
    slots.forEach((slot, k) => { next[slot] = ordered[k]; });
    available = next;
    applied.push(action);
  }

  const mergedInto: Record<string, string> = {};
  for (const id of merged.keys()) mergedInto[id] = resolve(id);
  if (applied.length === 0) return { state, applied, mergedInto, archivedIds };

  // The active group follows its tabs through a merge, and its own position through a reorder
  const activeIndex = Math.max(indexOf(resolve(state.active.id)), 0);
  return {
    state: { ...state, available, active: { id: available[activeIndex]?.id ?? '', index: activeIndex } },
    applied,
    mergedInto,
    archivedIds
  };
}

/**
 * URL rules after merges: a rule pointing at a merged-away group now points at the group that
 * holds its tabs (the same as the AI banner's Merge), so it keeps routing those URLs instead of
 * pointing at nothing. Null when no rule changes.
 */
export function retargetUrlRules(rules: readonly UrlRule[], mergedInto: Record<string, string>): UrlRule[] | null {
  if (!Array.isArray(rules)) return null;
  let changed = false;
  const next = rules.map((rule) => {
    const to = rule && Object.prototype.hasOwnProperty.call(mergedInto, rule.groupId) ? mergedInto[rule.groupId] : undefined;
    if (!to) return rule;
    changed = true;
    return { ...rule, groupId: to };
  });
  return changed ? next : null;
}
