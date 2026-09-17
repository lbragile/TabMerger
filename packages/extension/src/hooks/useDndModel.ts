import { useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupsState } from '@/lib/types';
import { GROUPS_QUERY_KEY } from './useGroups';

/**
 * Normalised, DnD-friendly view of the (already-decrypted, in-memory) groups state.
 *
 * Saved windows/tabs all carry `id: 0`, so this model NEVER keys off `window.id` /
 * `tab.id`. Instead it synthesises stable positional ids:
 *   group   →  `group.id`                       (real nanoid — unique)
 *   window  →  `${groupId}::w${windowIndex}`
 *   tab     →  `${windowModelId}::t${tabIndex}`
 *
 * Two `id:0` windows in the same group therefore get distinct model ids, and two
 * `id:0` tabs in different windows never collide. Every window carries a `groupId`
 * back-pointer and every tab a `windowId` back-pointer, each resolving to a real
 * parent entry in the corresponding map.
 */
export interface DndModelGroup {
  id: string;
  windowIds: string[];
  /** render-order index into `groupsState.available` */
  index: number;
}

export interface DndModelWindow {
  id: string;
  groupId: string;
  tabIds: string[];
  groupIndex: number;
  windowIndex: number;
}

export interface DndModelTab {
  id: string;
  windowId: string;
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
}

export interface DndModel {
  groups: Record<string, DndModelGroup>;
  windows: Record<string, DndModelWindow>;
  tabs: Record<string, DndModelTab>;
  /** render order; `groupIds[0]` === `permanentGroupId` whenever a permanent group exists */
  groupIds: string[];
  permanentGroupId: string;
}

const EMPTY_STATE: GroupsState = { active: { id: '', index: 0 }, available: [] };

/** Pure: build the normalised DnD model from a groups state snapshot. */
export function buildDndModel(groupsState: GroupsState): DndModel {
  const groups: Record<string, DndModelGroup> = {};
  const windows: Record<string, DndModelWindow> = {};
  const tabs: Record<string, DndModelTab> = {};
  const groupIds: string[] = [];

  const available = groupsState?.available ?? [];

  available.forEach((group, groupIndex) => {
    const gid = group.id;
    groupIds.push(gid);
    const windowIds: string[] = [];

    (group.windows ?? []).forEach((w, windowIndex) => {
      const wid = `${gid}::w${windowIndex}`;
      windowIds.push(wid);
      const tabIds: string[] = [];

      (w.tabs ?? []).filter(Boolean).forEach((_tab, tabIndex) => {
        const tid = `${wid}::t${tabIndex}`;
        tabIds.push(tid);
        tabs[tid] = { id: tid, windowId: wid, groupIndex, windowIndex, tabIndex };
      });

      windows[wid] = { id: wid, groupId: gid, tabIds, groupIndex, windowIndex };
    });

    groups[gid] = { id: gid, windowIds, index: groupIndex };
  });

  const permanent = available.find((g) => g.permanent);
  const permanentGroupId = permanent ? permanent.id : '';

  return { groups, windows, tabs, groupIds, permanentGroupId };
}

// ─── legacy ⇄ model selection-id mapping ─────────────────────────────────────
//
// `uiStore.selectedItems` stores POSITIONAL legacy ids (`tab-{gi}-{wi}-{ti}`,
// `window-{gi}-{wi}`, `group-{gi}`) where `gi` indexes `groupsState.available`.
// The unified DnD layer keys off synthesised model ids. These two pure helpers
// bridge the multi-select drag path.

const LEGACY_ID_RE = /^(tab|window|group)-(\d+)(?:-(\d+))?(?:-(\d+))?$/;

/** `tab-1-0-2` → `${available[1].id}::w0::t2`. Returns `null` if it can't resolve. */
export function legacySelectionIdToModelId(model: DndModel, legacyId: string): string | null {
  const match = LEGACY_ID_RE.exec(legacyId);
  if (!match) return null;
  const [, kind, giStr, wiStr, tiStr] = match;
  const groupId = model.groupIds[Number(giStr)];
  if (!groupId) return null;
  if (kind === 'group') return model.groups[groupId] ? groupId : null;
  if (kind === 'window') {
    const wid = `${groupId}::w${Number(wiStr)}`;
    return model.windows[wid] ? wid : null;
  }
  const tid = `${groupId}::w${Number(wiStr)}::t${Number(tiStr)}`;
  return model.tabs[tid] ? tid : null;
}

/** Inverse of {@link legacySelectionIdToModelId}, via the model's positional back-pointers. */
export function modelIdToLegacySelectionId(model: DndModel, modelId: string): string | null {
  const t = model.tabs[modelId];
  if (t) return `tab-${t.groupIndex}-${t.windowIndex}-${t.tabIndex}`;
  const w = model.windows[modelId];
  if (w) return `window-${w.groupIndex}-${w.windowIndex}`;
  const g = model.groups[modelId];
  if (g) return `group-${g.index}`;
  return null;
}

/**
 * Reactive hook wrapper — rebuilds the model whenever the `['groups']` query cache
 * entry changes (drag commits write there via `qc.setQueryData`).
 */
export function useDndModel(): DndModel {
  const qc = useQueryClient();
  const state = useSyncExternalStore(
    (onChange) => qc.getQueryCache().subscribe(onChange),
    () => qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY),
    () => undefined
  );
  return useMemo(() => buildDndModel(state ?? EMPTY_STATE), [state]);
}
