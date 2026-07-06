import { useCallback } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import { saveGroupsState } from '@/lib/localDb';
import type { GroupsState } from '@/lib/types';
import { sortWindowsByStarred } from '@/lib/utils';
import { GROUPS_QUERY_KEY } from './useGroups';
import { useUIStore } from '@/stores/uiStore';

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
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);

  const onDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const from = parseDndId(String(active.id));
      const to = parseDndId(String(over.id));

      if (from.kind !== 'group' || to.kind !== 'group') return;

      // Read from query cache — same order the UI renders — not IDB which re-sorts by updatedAt
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      if (!state) return;
      const available = [...state.available];

      // Don't allow moving the permanent group
      if (available[from.groupIndex]?.permanent) return;
      // Don't allow dropping before the permanent group
      if (to.groupIndex === 0) return;

      const dropTarget = available[to.groupIndex];
      const shouldBeStarred = dropTarget?.starred ?? false;

      const [moved] = available.splice(from.groupIndex, 1);
      moved.starred = shouldBeStarred; // ponytail: match zone before re-sort clamps position
      moved.updatedAt = Date.now();
      moved.pendingSync = true;
      available.splice(to.groupIndex, 0, moved);

      // Enforce zone order: Now Open → starred → unstarred.
      // Re-sorting after the splice preserves relative order within each zone
      // while clamping cross-zone drops to the zone boundary.
      const nowOpenGroup = available[0];
      const rest = available.slice(1);
      const zoneSorted = [
        nowOpenGroup,
        ...rest.filter((g) => g.starred),
        ...rest.filter((g) => !g.starred)
      ];
      const newIndex = zoneSorted.findIndex((g) => g.id === moved.id);

      const finalIndex = newIndex >= 0 ? newIndex : to.groupIndex;
      const next = { ...state, active: { id: moved.id, index: finalIndex }, available: zoneSorted };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);

      // Keep the dragged group selected at its new position (Task 12)
      setActiveGroupIndex(finalIndex);
    },
    [qc, setActiveGroupIndex]
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

      // Read from query cache — same order the UI renders — not IDB which re-sorts by updatedAt
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      if (!state) return;
      const available = [...state.available];
      const group = { ...available[groupIndex] };
      const windows = [...group.windows];

      // Move within same group
      if (to.kind === 'window' && to.groupIndex === groupIndex) {
        const dropTarget = windows[to.windowIndex];
        const shouldBeStarred = dropTarget?.starred ?? false;

        const [moved] = windows.splice(from.windowIndex, 1);
        moved.starred = shouldBeStarred; // ponytail: match zone before re-sort clamps position
        windows.splice(to.windowIndex, 0, moved);
        group.windows = sortWindowsByStarred(windows);
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

