import { useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupsState } from '@/lib/types';
import { isTourDemoGroup } from '@tabmerger/shared';
import { getTourTabSandbox, subscribeTourTabSandbox, type TourTabSandbox } from '@/lib/tourSandbox';
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
  /**
   * Starred groups are PINNED above unstarred ones in the sidebar, so `starred` is not
   * decoration — it is the item's ZONE, and a reorder may only target positions inside
   * its own zone (`@/lib/dndMove`'s `canDrop` rejects a selection that spans both).
   */
  starred: boolean;
  /**
   * Practice data of the guided tour (`isTourDemoGroup`). A sealed sandbox for drag and drop:
   * its items only move between practice groups, and nothing else moves in (`canDrop`).
   */
  tourDemo: boolean;
}

export interface DndModelWindow {
  id: string;
  groupId: string;
  tabIds: string[];
  groupIndex: number;
  windowIndex: number;
  /** Zone flag, exactly as for a group: starred windows are pinned above unstarred ones. */
  starred: boolean;
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
  /**
   * Present only while the guided tour's "save a tab" step is up (`lib/tourSandbox.ts`).
   * `tabId` is the model id of the tour's own practice tab in "Now Open", or `null` while that
   * tab is not on the list. `canDrop` then allows one move out of Now Open: that tab, onto the
   * tour's practice groups.
   */
  tourPractice?: { tabId: string | null };
}

const EMPTY_STATE: GroupsState = { active: { id: '', index: 0 }, available: [] };

/**
 * Build the normalised DnD model from a groups state snapshot. `sandbox` is the guided tour's
 * "save a tab" step (read from its own small store unless given): see {@link DndModel.tourPractice}.
 */
export function buildDndModel(groupsState: GroupsState, sandbox: TourTabSandbox | null = getTourTabSandbox()): DndModel {
  let practiceTabModelId: string | null = null;
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

      (w.tabs ?? []).filter(Boolean).forEach((tab, tabIndex) => {
        const tid = `${wid}::t${tabIndex}`;
        tabIds.push(tid);
        // Only a LIVE tab (Now Open) has a real id; saved tabs all carry 0
        if (sandbox && group.permanent && sandbox.tabId !== null && tab.id === sandbox.tabId) practiceTabModelId = tid;
        tabs[tid] = { id: tid, windowId: wid, groupIndex, windowIndex, tabIndex };
      });

      windows[wid] = { id: wid, groupId: gid, tabIds, groupIndex, windowIndex, starred: !!w.starred };
    });

    groups[gid] = { id: gid, windowIds, index: groupIndex, starred: !!group.starred, tourDemo: isTourDemoGroup(group) };
  });

  const permanent = available.find((g) => g.permanent);
  const permanentGroupId = permanent ? permanent.id : '';

  const model: DndModel = { groups, windows, tabs, groupIds, permanentGroupId };
  if (sandbox) model.tourPractice = { tabId: practiceTabModelId };
  return model;
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
  const sandbox = useSyncExternalStore(subscribeTourTabSandbox, getTourTabSandbox, () => null);
  return useMemo(() => buildDndModel(state ?? EMPTY_STATE, sandbox), [state, sandbox]);
}
