import { useCallback } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { createWindow, sortWindowsByStarred } from '@/lib/utils';
import { GROUPS_QUERY_KEY } from './useGroups';

/**
 * DnD ID format:
 *   tab:    "tab-{groupIdx}-{windowIdx}-{tabIdx}"
 *   window: "window-{groupIdx}-{windowIdx}"
 *   group:  "group-{groupIdx}"
 */
export function parseDndId(id: string) {
  const parts = id.split('-');
  const kind = parts[0];
  return {
    kind,
    groupIndex: parseInt(parts[1] ?? '0', 10),
    windowIndex: parseInt(parts[2] ?? '0', 10),
    tabIndex: parseInt(parts[3] ?? '0', 10)
  };
}

export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
}

export function useGroupDndHandlers() {
  const qc = useQueryClient();

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const from = parseDndId(String(active.id));
      const to = parseDndId(String(over.id));

      if (from.kind !== 'group' || to.kind !== 'group') return;

      const state = await getGroupsState();
      const available = [...state.available];

      // Don't allow moving the permanent group
      if (available[from.groupIndex]?.permanent) return;
      // Don't allow dropping before the permanent group
      if (to.groupIndex === 0) return;

      const [moved] = available.splice(from.groupIndex, 1);
      available.splice(to.groupIndex, 0, moved);

      const next = { ...state, active: { id: moved.id, index: to.groupIndex }, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    },
    [qc]
  );

  return { onDragEnd };
}

export function useWindowDndHandlers(groupIndex: number) {
  const qc = useQueryClient();

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const from = parseDndId(String(active.id));
      const to = parseDndId(String(over.id));

      if (from.kind !== 'window') return;

      const state = await getGroupsState();
      const available = [...state.available];
      const group = { ...available[groupIndex] };
      const windows = [...group.windows];

      // Move within same group
      if (to.kind === 'window' && to.groupIndex === groupIndex) {
        const [moved] = windows.splice(from.windowIndex, 1);
        windows.splice(to.windowIndex, 0, moved);
        group.windows = windows;
        group.updatedAt = Date.now();
        group.pendingSync = true;
        available[groupIndex] = group;
        const next = { ...state, available };
        await saveGroupsState(next);
        qc.setQueryData(GROUPS_QUERY_KEY, next);
        return;
      }

      // Drop onto a different group (sidebar combine)
      if (to.kind === 'group' && to.groupIndex !== groupIndex) {
        const [moved] = windows.splice(from.windowIndex, 1);
        moved.focused = false;
        moved.starred = false;

        available[groupIndex] = { ...group, windows, updatedAt: Date.now(), pendingSync: true };

        const targetGroup = { ...available[to.groupIndex] };
        targetGroup.windows = sortWindowsByStarred([moved, ...targetGroup.windows]);
        targetGroup.updatedAt = Date.now();
        targetGroup.pendingSync = true;
        available[to.groupIndex] = targetGroup;

        const next = { ...state, available };
        await saveGroupsState(next);
        qc.setQueryData(GROUPS_QUERY_KEY, next);
      }
    },
    [qc, groupIndex]
  );

  return { onDragEnd };
}

export function useTabDndHandlers(groupIndex: number) {
  const qc = useQueryClient();

  const onDragOver = useCallback(
    async (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;

      const from = parseDndId(String(active.id));
      const to = parseDndId(String(over.id));

      if (from.kind !== 'tab') return;

      // Moving between windows in same group
      if (from.windowIndex === to.windowIndex) return;

      const state = await getGroupsState();
      const available = [...state.available];
      const group = { ...available[groupIndex] };
      const windows = group.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));

      const [movedTab] = windows[from.windowIndex].tabs.splice(from.tabIndex, 1);
      const targetWindowIdx = to.kind === 'tab' ? to.windowIndex : to.windowIndex;
      const targetTabIdx = to.kind === 'tab' ? to.tabIndex : windows[targetWindowIdx].tabs.length;
      windows[targetWindowIdx].tabs.splice(targetTabIdx, 0, movedTab);

      group.windows = windows;
      group.updatedAt = Date.now();
      group.pendingSync = true;
      available[groupIndex] = group;

      const next = { ...state, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    },
    [qc, groupIndex]
  );

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const from = parseDndId(String(active.id));
      const to = parseDndId(String(over.id));

      if (from.kind !== 'tab') return;
      if (from.windowIndex !== to.windowIndex) return; // handled by onDragOver

      const state = await getGroupsState();
      const available = [...state.available];
      const group = { ...available[groupIndex] };
      const windows = group.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));

      const [movedTab] = windows[from.windowIndex].tabs.splice(from.tabIndex, 1);
      windows[to.windowIndex].tabs.splice(to.tabIndex, 0, movedTab);

      group.windows = windows;
      group.updatedAt = Date.now();
      group.pendingSync = true;
      available[groupIndex] = group;

      const next = { ...state, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    },
    [qc, groupIndex]
  );

  // Handle cross-group tab drop onto sidebar
  const onTabDropToGroup = useCallback(
    async (
      fromGroupIndex: number,
      fromWindowIndex: number,
      fromTabIndex: number,
      toGroupIndex: number
    ) => {
      const state = await getGroupsState();
      const available = [...state.available];

      const fromGroup = { ...available[fromGroupIndex] };
      const windows = fromGroup.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));
      const [movedTab] = windows[fromWindowIndex].tabs.splice(fromTabIndex, 1);

      fromGroup.windows = windows;
      fromGroup.updatedAt = Date.now();
      fromGroup.pendingSync = true;
      available[fromGroupIndex] = fromGroup;

      const toGroup = { ...available[toGroupIndex] };
      const newWindow = createWindow([movedTab]);
      toGroup.windows = sortWindowsByStarred([newWindow, ...toGroup.windows]);
      toGroup.updatedAt = Date.now();
      toGroup.pendingSync = true;
      available[toGroupIndex] = toGroup;

      const next = { ...state, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    },
    [qc]
  );

  return { onDragOver, onDragEnd, onTabDropToGroup };
}
