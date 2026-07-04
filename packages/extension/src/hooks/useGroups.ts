import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import type { Group, GroupsState } from '@/lib/types';
import { DEFAULT_GROUP_COLOR } from '@/lib/types';
import { getGroupsState, saveGroupsState, deleteGroup as dbDeleteGroup } from '@/lib/localDb';
import { createGroup, createWindow, sortWindowsByStarred, getGroupInfo } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';

export const GROUPS_QUERY_KEY = ['groups'] as const;

export function useGroups() {
  return useQuery({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: getGroupsState,
    staleTime: Infinity
  });
}

function useGroupsMutation() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);

  return (mutFn: (prev: GroupsState) => GroupsState, skipUndo = false) =>
    qc.fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState }).then(async (prev) => {
      if (!skipUndo) pushUndo(prev);
      const next = mutFn(prev);
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
      return next;
    });
}

export function useAddGroup() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ name, color }: { name?: string; color?: string }) =>
      mutate((prev) => {
        const newGroup = createGroup(nanoid(10), name, color ?? DEFAULT_GROUP_COLOR);
        return { ...prev, available: [...prev.available, newGroup] };
      })
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const { active, available } = prev;
        const target = available[groupIndex];
        if (!target || target.permanent) return prev;

        const newAvailable = available.filter((_, i) => i !== groupIndex);
        void dbDeleteGroup(target.id);

        const newActiveIndex =
          active.index >= groupIndex && active.index > 0 ? active.index - 1 : active.index;
        const newActiveId = newAvailable[newActiveIndex]?.id ?? newAvailable[0]?.id ?? '';

        return { active: { id: newActiveId, index: newActiveIndex }, available: newAvailable };
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY })
  });
}

export function useDuplicateGroup() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const { available } = prev;
        const source = available[groupIndex];
        if (!source) return prev;

        const clone: Group = {
          ...JSON.parse(JSON.stringify(source)),
          id: nanoid(10),
          permanent: false,
          updatedAt: Date.now(),
          pendingSync: true
        };

        const newAvailable = [...available];
        newAvailable.splice(groupIndex + 1, 0, clone);
        return { ...prev, available: newAvailable };
      })
  });
}

export function useUpdateGroupColor() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, color }: { groupIndex: number; color: string }) =>
      mutate((prev) => {
        const available = [...prev.available];
        available[groupIndex] = {
          ...available[groupIndex],
          color,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      })
  });
}

export function useUpdateGroupName() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, name }: { groupIndex: number; name: string }) =>
      mutate((prev) => {
        const available = [...prev.available];
        available[groupIndex] = {
          ...available[groupIndex],
          name,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      })
  });
}

export function useUpdateGroupInfo() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, info }: { groupIndex: number; info: string }) =>
      mutate(
        (prev) => {
          const available = [...prev.available];
          available[groupIndex] = { ...available[groupIndex], info };
          return { ...prev, available };
        },
        true // skip undo for info updates
      )
  });
}

export function useReorderGroups() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ from, to }: { from: number; to: number }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const [moved] = available.splice(from, 1);
        available.splice(to, 0, moved);
        return { active: { id: moved.id, index: to }, available };
      })
  });
}

export function useAddWindow() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, name }: { groupIndex: number; name?: string }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const newWindow = createWindow([], name);
        available[groupIndex] = {
          ...available[groupIndex],
          windows: [...available[groupIndex].windows, newWindow],
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useDeleteWindow() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, windowIndex }: { groupIndex: number; windowIndex: number }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = available[groupIndex].windows.filter((_, i) => i !== windowIndex);
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useUpdateWindowName() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({
      groupIndex,
      windowIndex,
      name
    }: {
      groupIndex: number;
      windowIndex: number;
      name: string;
    }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        windows[windowIndex] = { ...windows[windowIndex], name };
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      })
  });
}

export function useToggleWindowStarred() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, windowIndex }: { groupIndex: number; windowIndex: number }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        windows[windowIndex] = { ...windows[windowIndex], starred: !windows[windowIndex].starred };
        available[groupIndex] = {
          ...available[groupIndex],
          windows: sortWindowsByStarred(windows),
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      })
  });
}

export function useToggleWindowIncognito() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, windowIndex }: { groupIndex: number; windowIndex: number }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        windows[windowIndex] = {
          ...windows[windowIndex],
          incognito: !windows[windowIndex].incognito
        };
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      })
  });
}

export function useDeleteTab() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({
      groupIndex,
      windowIndex,
      tabIndex
    }: {
      groupIndex: number;
      windowIndex: number;
      tabIndex: number;
    }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        const tabs = windows[windowIndex].tabs.filter((_, i) => i !== tabIndex);
        windows[windowIndex] = { ...windows[windowIndex], tabs };
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useReplaceWithCurrent() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const currentWindows = JSON.parse(JSON.stringify(available[0].windows));
        currentWindows.forEach((w: Group['windows'][0]) => (w.focused = false));
        available[groupIndex] = {
          ...available[groupIndex],
          windows: currentWindows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useMergeWithCurrent() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const currentWindows = JSON.parse(JSON.stringify(available[0].windows));
        currentWindows.forEach((w: Group['windows'][0]) => (w.focused = false));
        available[groupIndex] = {
          ...available[groupIndex],
          windows: [...currentWindows, ...available[groupIndex].windows],
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useUniteWindows() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const group = available[groupIndex];
        const allTabs = group.windows.flatMap((w) => w.tabs);
        const united = { ...group.windows[0], tabs: allTabs };
        available[groupIndex] = {
          ...group,
          windows: [united],
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useSplitWindows() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const group = available[groupIndex];
        const allTabs = group.windows.flatMap((w) => w.tabs);
        available[groupIndex] = {
          ...group,
          windows: allTabs.map((tab) => createWindow([tab])),
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

export function useSortTabs() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, by }: { groupIndex: number; by: 'title' | 'url' }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = available[groupIndex].windows.map((w) => ({
          ...w,
          tabs: [...w.tabs].sort((a, b) => {
            const aVal = by === 'title' ? (a.title ?? '') : (a.url ?? '');
            const bVal = by === 'title' ? (b.title ?? '') : (b.url ?? '');
            return aVal.localeCompare(bVal);
          })
        }));
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      })
  });
}

export function useSetGroupsState() {
  const qc = useQueryClient();

  return async (state: GroupsState) => {
    await saveGroupsState(state);
    qc.setQueryData(GROUPS_QUERY_KEY, state);
  };
}
