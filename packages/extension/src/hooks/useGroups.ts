import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import type { Group, GroupsState } from '@/lib/types';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from '@/lib/types';
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

/** Returns the set of URLs currently open in the Now Open group (index 0). */
function getNowOpenUrls(state: GroupsState | undefined): Set<string> {
  const nowOpen = state?.available[0];
  if (!nowOpen) return new Set();
  return new Set(nowOpen.windows.flatMap((w) => w.tabs.map((t) => t.url)));
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async (groupIndex: number) => {
      // Only close browser tabs that are actually live in the Now Open group (Task 23)
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const target = state?.available[groupIndex];
      if (target && !target.permanent) {
        const liveUrls = getNowOpenUrls(state);
        const tabIds = target.windows
          .flatMap((w) => w.tabs)
          .filter((t) => liveUrls.has(t.url))
          .map((t) => t.id);
        if (tabIds.length > 0) {
          chrome.tabs.remove(tabIds).catch(() => {});
        }
      }

      return mutate((prev) => {
        const { active, available } = prev;
        const group = available[groupIndex];
        if (!group || group.permanent) return prev;

        const newAvailable = available.filter((_, i) => i !== groupIndex);
        void dbDeleteGroup(group.id);

        const newActiveIndex =
          active.index >= groupIndex && active.index > 0 ? active.index - 1 : active.index;
        const newActiveId = newAvailable[newActiveIndex]?.id ?? newAvailable[0]?.id ?? '';

        return { active: { id: newActiveId, index: newActiveIndex }, available: newAvailable };
      });
    },
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
          name: DEFAULT_GROUP_TITLE,
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

export function useUpdateGroupNote() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, note }: { groupIndex: number; note: string }) =>
      mutate(
        (prev) => {
          const available = [...prev.available];
          available[groupIndex] = { ...available[groupIndex], note, updatedAt: Date.now(), pendingSync: true };
          return { ...prev, available };
        },
        true
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
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({ groupIndex, windowIndex }: { groupIndex: number; windowIndex: number }) => {
      // Only close browser tabs that are actually live in the Now Open group (Task 23)
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const windowObj = state?.available[groupIndex]?.windows[windowIndex];
      if (windowObj) {
        const liveUrls = getNowOpenUrls(state);
        const tabIds = windowObj.tabs.filter((t) => liveUrls.has(t.url)).map((t) => t.id);
        if (tabIds.length > 0) {
          chrome.tabs.remove(tabIds).catch(() => {});
        }
      }

      return mutate((prev) => {
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
      });
    }
  });
}

export function useDeleteAllWindows() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({ groupIndex }: { groupIndex: number }) => {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const group = state?.available[groupIndex];
      if (group) {
        const liveUrls = getNowOpenUrls(state);
        const tabIds = group.windows
          .flatMap((w) => w.tabs)
          .filter((t) => liveUrls.has(t.url))
          .map((t) => t.id);
        if (tabIds.length > 0) chrome.tabs.remove(tabIds).catch(() => {});
      }

      return mutate((prev) => {
        const available = [...prev.available];
        available[groupIndex] = {
          ...available[groupIndex],
          windows: [],
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      });
    }
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

export function useToggleGroupStar() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        available[groupIndex] = {
          ...available[groupIndex],
          starred: !available[groupIndex].starred,
          updatedAt: Date.now(),
          pendingSync: true
        };

        // Re-sort: Now Open (permanent) first, then starred groups, then unstarred groups.
        // Relative order within each zone is preserved.
        const nowOpen = available[0];
        const rest = available.slice(1);
        const sorted = [
          nowOpen,
          ...rest.filter((g) => g.starred),
          ...rest.filter((g) => !g.starred)
        ];

        // Recalculate active index in case the toggled group moved zones
        const newActiveIndex = sorted.findIndex((g) => g.id === prev.active.id);
        return {
          active: { id: prev.active.id, index: newActiveIndex >= 0 ? newActiveIndex : prev.active.index },
          available: sorted
        };
      })
  });
}

// URLs that cannot be programmatically opened (chrome://, about:, extension pages, etc.)
// ponytail: matches scheme: prefix — covers both about:blank and chrome://newtab
export const RESTRICTED_URL_RE = /^(chrome|about|chrome-extension|moz-extension):/i;

export function useToggleWindowIncognito() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({ groupIndex, windowIndex }: { groupIndex: number; windowIndex: number }) => {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const group = state?.available[groupIndex];

      // Now Open group: manipulate the real browser window; useCurrentTabs will sync state
      if (group?.permanent) {
        const win = group.windows[windowIndex];
        const tabUrls = win.tabs.map((t) => t.url).filter((u) => u && !RESTRICTED_URL_RE.test(u));
        const oldWindowId = win.id;
        await chrome.windows.create({ incognito: !win.incognito, url: tabUrls, focused: true });
        await chrome.windows.remove(oldWindowId);
        return;
      }

      // Saved group: flip the flag in IndexedDB only
      return mutate((prev) => {
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
      });
    }
  });
}

export function useDeleteTab() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({
      groupIndex,
      windowIndex,
      tabIndex
    }: {
      groupIndex: number;
      windowIndex: number;
      tabIndex: number;
    }) => {
      // Only close the browser tab if its URL is live in the Now Open group (Task 23)
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const tab = state?.available[groupIndex]?.windows[windowIndex]?.tabs[tabIndex];
      if (tab?.id) {
        const liveUrls = getNowOpenUrls(state);
        if (liveUrls.has(tab.url)) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
      }

      return mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        const tabs = windows[windowIndex].tabs.filter((_, i) => i !== tabIndex);

        // Task 15: auto-close the source window if it becomes empty and the group has > 1 window
        let updatedWindows: typeof windows;
        if (tabs.length === 0 && windows.length > 1) {
          updatedWindows = windows.filter((_, i) => i !== windowIndex);
        } else {
          windows[windowIndex] = { ...windows[windowIndex], tabs };
          updatedWindows = windows;
        }

        available[groupIndex] = {
          ...available[groupIndex],
          windows: updatedWindows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      });
    }
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

export function useMoveTab() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({
      fromGroupIndex,
      fromWindowIndex,
      fromTabIndex,
      toGroupIndex,
      copy = false
    }: {
      fromGroupIndex: number;
      fromWindowIndex: number;
      fromTabIndex: number;
      toGroupIndex: number;
      /** When true, leave the source tab in place (used when source is Now Open / permanent). */
      copy?: boolean;
    }) => {
      // Capture ogImage before the sync mutation runs
      let ogImage: string | undefined;
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const sourceTab = state?.available[fromGroupIndex]?.windows[fromWindowIndex]?.tabs[fromTabIndex];
      if (sourceTab) {
        if (sourceTab.id > 0) {
          // Live Now Open tab — fetch from content script
          try {
            const meta = await chrome.tabs.sendMessage(sourceTab.id, { type: 'GET_PAGE_META' });
            ogImage = (meta as { ogImage?: string })?.ogImage ?? undefined;
          } catch {
            ogImage = undefined;
          }
        } else {
          // Already saved tab being moved between groups — carry through existing ogImage
          ogImage = sourceTab.ogImage;
        }
      }

      // Moving to Now Open → open in browser; useCurrentTabs sync will pick it up automatically
      if (state?.available[toGroupIndex]?.permanent) {
        if (sourceTab?.url && !RESTRICTED_URL_RE.test(sourceTab.url)) {
          chrome.tabs.create({ url: sourceTab.url, active: false }).catch(() => {});
        }
        // If source is also Now Open (copy=true), the browser tab already exists — nothing to remove
        if (copy) return;
        return mutate((prev) => {
          const available = [...prev.available];
          const fromGroup = { ...available[fromGroupIndex] };
          const fromWindows = fromGroup.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));
          fromWindows[fromWindowIndex].tabs.splice(fromTabIndex, 1);
          fromGroup.windows =
            fromWindows[fromWindowIndex].tabs.length === 0 && fromWindows.length > 1
              ? fromWindows.filter((_, i) => i !== fromWindowIndex)
              : fromWindows;
          fromGroup.updatedAt = Date.now();
          fromGroup.pendingSync = true;
          fromGroup.info = getGroupInfo(fromGroup);
          available[fromGroupIndex] = fromGroup;
          return { ...prev, available };
        });
      }

      return mutate((prev) => {
        const available = [...prev.available];

        const fromGroup = { ...available[fromGroupIndex] };
        const fromWindows = fromGroup.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));

        let movedTab;
        if (copy) {
          // ponytail: id:0 is falsy — useDeleteTab's `if (tab?.id)` guard won't close the live browser tab
          movedTab = { ...fromWindows[fromWindowIndex].tabs[fromTabIndex], id: 0, ogImage };
        } else {
          // Remove tab from source window
          [movedTab] = fromWindows[fromWindowIndex].tabs.splice(fromTabIndex, 1);
          movedTab = { ...movedTab, ogImage };

          // Task 15: auto-close empty source window if the group still has other windows
          const finalFromWindows =
            fromWindows[fromWindowIndex].tabs.length === 0 && fromWindows.length > 1
              ? fromWindows.filter((_, i) => i !== fromWindowIndex)
              : fromWindows;

          fromGroup.windows = finalFromWindows;
          fromGroup.updatedAt = Date.now();
          fromGroup.pendingSync = true;
          fromGroup.info = getGroupInfo(fromGroup);
          available[fromGroupIndex] = fromGroup;
        }

        // Add tab to destination group in a new window at the top
        const toGroup = { ...available[toGroupIndex] };
        const newWin = createWindow([movedTab]);
        toGroup.windows = sortWindowsByStarred([newWin, ...toGroup.windows]);
        toGroup.updatedAt = Date.now();
        toGroup.pendingSync = true;
        toGroup.info = getGroupInfo(toGroup);
        available[toGroupIndex] = toGroup;

        return { ...prev, available };
      });
    }
  });
}

export function useMoveWindow() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({
      fromGroupIndex,
      windowIndex,
      toGroupIndex
    }: {
      fromGroupIndex: number;
      windowIndex: number;
      toGroupIndex: number;
    }) => {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);

      // Moving to Now Open → open in browser; useCurrentTabs sync will pick it up automatically
      if (state?.available[toGroupIndex]?.permanent) {
        const win = state.available[fromGroupIndex]?.windows[windowIndex];
        if (win) {
          const urls = win.tabs.map((t) => t.url).filter((u) => u && !RESTRICTED_URL_RE.test(u));
          if (urls.length > 0) chrome.windows.create({ url: urls, focused: false }).catch(() => {});
        }
        // If source is also Now Open, browser window already exists — nothing to remove
        if (state.available[fromGroupIndex]?.permanent) return;
        return mutate((prev) => {
          const available = [...prev.available];
          const fromGroup = { ...available[fromGroupIndex] };
          fromGroup.windows = fromGroup.windows.filter((_, i) => i !== windowIndex);
          fromGroup.updatedAt = Date.now();
          fromGroup.pendingSync = true;
          fromGroup.info = getGroupInfo(fromGroup);
          available[fromGroupIndex] = fromGroup;
          return { ...prev, available };
        });
      }

      return mutate((prev) => {
        const available = [...prev.available];

        // Remove window from source group
        const fromGroup = { ...available[fromGroupIndex] };
        const fromWindows = [...fromGroup.windows];
        const [movedWindow] = fromWindows.splice(windowIndex, 1);
        fromGroup.windows = fromWindows;
        fromGroup.updatedAt = Date.now();
        fromGroup.pendingSync = true;
        fromGroup.info = getGroupInfo(fromGroup);
        available[fromGroupIndex] = fromGroup;

        // Append window to target group (sorted by starred)
        const toGroup = { ...available[toGroupIndex] };
        toGroup.windows = sortWindowsByStarred([...toGroup.windows, { ...movedWindow }]);
        toGroup.updatedAt = Date.now();
        toGroup.pendingSync = true;
        toGroup.info = getGroupInfo(toGroup);
        available[toGroupIndex] = toGroup;

        return { ...prev, available };
      });
    }
  });
}

export function useSetGroupsState() {
  const qc = useQueryClient();

  return async (state: GroupsState) => {
    await saveGroupsState(state);
    qc.setQueryData(GROUPS_QUERY_KEY, state);
  };
}
