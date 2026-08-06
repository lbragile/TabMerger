import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import type { Group, GroupsState, Tab } from '@/lib/types';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from '@/lib/types';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { deleteRemoteGroups } from '@/lib/syncEngine';
import { createGroup, createWindow, sortWindowsByStarred, getGroupInfo } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';

export const GROUPS_QUERY_KEY = ['groups'] as const;

async function getGroupsStateWithMigration() {
  const state = await getGroupsState();
  const now = Date.now();
  let dirty = false;
  state.available.forEach((g) => {
    if (g.permanent) return;
    g.windows.forEach((w) => {
      w.tabs.forEach((t) => {
        if (!t.savedAt) { t.savedAt = now; dirty = true; }
      });
    });
  });
  if (dirty) await saveGroupsState(state);
  return state;
}

/** Reads all groups from IndexedDB via TanStack Query. staleTime:0 so the popup always gets the latest on open. */
export function useGroups() {
  return useQuery({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: getGroupsStateWithMigration,
    /** always read fresh from IDB when popup opens; IndexedDB is cheap to query */
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

/**
 * Returns a typed mutation helper used by every group/window/tab mutation hook.
 * Pattern: fetch fresh IDB state → optionally push undo snapshot → apply transform → persist → update cache.
 * Pass `skipUndo=true` for operations that are too granular to undo (notes, info fields, Now Open sync).
 */
function useGroupsMutation() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);

  return (mutFn: (prev: GroupsState) => GroupsState, skipUndo = false) =>
    /** fetchQuery (not getQueryData) guarantees we mutate the latest IDB state even if the cache is stale */
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
      }),
    onSuccess: () => { trackEvent('group_created'); }
  });
}

/** Returns the set of URLs currently open in the Now Open group (index 0). */
function getNowOpenUrls(state: GroupsState | undefined): Set<string> {
  const nowOpen = state?.available[0];
  if (!nowOpen) return new Set();
  return new Set(nowOpen.windows.flatMap((w) => w.tabs.map((t) => t.url)));
}

/**
 * Removes a saved group from IndexedDB. If any of its tabs are live in Now Open,
 * closes them in Chrome first. Permanent groups (Now Open) are silently rejected.
 * Recalculates `active.index` so the sidebar never points to a stale slot.
 */
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

        trackEvent('group_deleted');

        // Fire-and-forget: hard-delete from Supabase so sync doesn't resurrect it on reload
        deleteRemoteGroups([group.id]).catch(() => {});

        const newAvailable = available.filter((_, i) => i !== groupIndex);

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
      }),
    onSuccess: () => { trackEvent('group_renamed'); }
  });
}

export function useUpdateGroupInfo() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, info }: { groupIndex: number; info: string }) =>
      mutate(
        (prev) => {
          const available = [...prev.available];
          const group = available[groupIndex];
          // ponytail: info-only edits skip undo (too granular), but must still mark pendingSync
          // so the change actually reaches Supabase — Now Open is exempt like every other mutation.
          available[groupIndex] = {
            ...group,
            info,
            ...(group.permanent ? {} : { updatedAt: Date.now(), pendingSync: true })
          };
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

export function useUpdateWindowNote() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({
      groupIndex,
      windowIndex,
      note
    }: {
      groupIndex: number;
      windowIndex: number;
      note: string;
    }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        windows[windowIndex] = { ...windows[windowIndex], note: note || undefined };
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      }, true)
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

/**
 * Toggles the starred flag on a group and re-sorts the sidebar into three zones:
 * Now Open (permanent, always index 0), starred groups, then unstarred groups.
 * Relative order within each zone is preserved; active.index is recalculated.
 */
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

/**
 * Toggles incognito mode for a window.
 * For Now Open (permanent) windows, reopens the real browser window in incognito and closes the old one —
 * `useCurrentTabs` will sync state automatically. For saved groups, only flips the flag in IndexedDB.
 */
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

/**
 * Removes a tab from a group. If the tab's URL is live in Now Open, closes it in Chrome.
 * Tabs with `id:0` are never sent to `chrome.tabs.remove` — they are saved copies, not live tabs.
 * Auto-collapses the source window when it becomes empty and the group still has other windows.
 */
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

export function useUpdateTabNote() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({
      groupIndex,
      windowIndex,
      tabIndex,
      note
    }: {
      groupIndex: number;
      windowIndex: number;
      tabIndex: number;
      note: string;
    }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        const tabs = [...windows[windowIndex].tabs];
        tabs[tabIndex] = { ...tabs[tabIndex], note: note || undefined };
        windows[windowIndex] = { ...windows[windowIndex], tabs };
        available[groupIndex] = {
          ...available[groupIndex],
          windows,
          updatedAt: Date.now(),
          pendingSync: true
        };
        return { ...prev, available };
      }, true) // ponytail: skip undo — note edits are too granular to undo per-keystroke
  });
}

/**
 * Overwrites a saved group's windows with a snapshot of the current Now Open (index 0) windows.
 * Stamps `savedAt` on any tabs that don't already have it. Used by "Update from current tabs".
 */
export function useReplaceWithCurrent() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const now = Date.now();
        const currentWindows = JSON.parse(JSON.stringify(available[0].windows));
        currentWindows.forEach((w: Group['windows'][0]) => {
          w.focused = false;
          w.tabs.forEach((t: Tab) => { if (!t.savedAt) t.savedAt = now; });
        });
        available[groupIndex] = {
          ...available[groupIndex],
          windows: currentWindows,
          updatedAt: now,
          pendingSync: true
        };
        available[groupIndex].info = getGroupInfo(available[groupIndex]);
        return { ...prev, available };
      })
  });
}

/**
 * Prepends a snapshot of the current Now Open windows to a saved group.
 * Unlike `useReplaceWithCurrent`, the group's existing windows are kept at the end.
 */
export function useMergeWithCurrent() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const now = Date.now();
        const currentWindows = JSON.parse(JSON.stringify(available[0].windows));
        currentWindows.forEach((w: Group['windows'][0]) => {
          w.focused = false;
          w.tabs.forEach((t: Tab) => { if (!t.savedAt) t.savedAt = now; });
        });
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

/**
 * Moves (or copies) a tab between groups, handling three cases:
 * 1. **To Now Open**: opens the URL in Chrome; `useCurrentTabs` syncs the resulting tab automatically.
 * 2. **From Now Open** (`copy=true`): stamps a saved copy without removing the live browser tab.
 * 3. **Between saved groups**: splices from source, appends to dest window list; auto-collapses empty source windows.
 * Also fetches `ogImage` from the content script when moving a live tab, and carries it through for saved tabs.
 */
export function useMoveTab() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    onSuccess: (_data, { toGroupIndex }) => {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      if (!state?.available[toGroupIndex]?.permanent) {
        trackEvent('tab_saved', { count: 1 });
        trackEvent('tabs_saved', { count: 1 });
      }
    },
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

        const savedAt = Date.now();
        let movedTab;
        if (copy) {
          // ponytail: id:0 is falsy — useDeleteTab's `if (tab?.id)` guard won't close the live browser tab
          movedTab = { ...fromWindows[fromWindowIndex].tabs[fromTabIndex], id: 0, ogImage, savedAt };
        } else {
          // Remove tab from source window
          [movedTab] = fromWindows[fromWindowIndex].tabs.splice(fromTabIndex, 1);
          // Preserve existing savedAt when moving between saved groups; stamp if from Now Open
          movedTab = { ...movedTab, ogImage, savedAt: movedTab.savedAt ?? savedAt };

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

/**
 * Moves an entire window between groups. Mirrors `useMoveTab`'s Now Open destination logic:
 * if the target is Now Open, opens the URLs in a new Chrome window and removes them from the source.
 * For saved-to-saved moves, appends the window to the target (sorted by starred).
 */
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

/**
 * Directly writes a full GroupsState to IndexedDB and updates the TanStack Query cache.
 * Bypasses the standard mutation pattern (no undo snapshot). Used by undo/redo to restore
 * a previous snapshot without triggering another undo entry.
 */
export function useSetGroupsState() {
  const qc = useQueryClient();

  return async (state: GroupsState) => {
    await saveGroupsState(state);
    qc.setQueryData(GROUPS_QUERY_KEY, state);
  };
}

/** Removes duplicate tabs (by URL) from a group. For Now Open, also closes them in Chrome. */
export function useDeduplicateGroup() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({ groupIndex, duplicateIds }: { groupIndex: number; duplicateIds: number[] }) => {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const group = state?.available[groupIndex];
      if (!group) return;
      // For Now Open, close browser tabs
      if (group.permanent && duplicateIds.length > 0) {
        chrome.tabs.remove(duplicateIds).catch(() => {});
      }
      const idSet = new Set(duplicateIds);
      return mutate(
        (prev) => {
          const available = [...prev.available];
          const g = available[groupIndex];
          const updatedWindows = g.windows.map((w) => ({
            ...w,
            tabs: w.tabs.filter((t) => !idSet.has(t.id))
          })).filter((w) => w.tabs.length > 0)
          available[groupIndex] = {
            ...g,
            windows: updatedWindows,
            updatedAt: Date.now(),
            pendingSync: !g.permanent
          };
          available[groupIndex].info = getGroupInfo(available[groupIndex]);
          return { ...prev, available };
        },
        group.permanent // skip undo for Now Open
      );
    }
  });
}

/** Removes all tabs older than staleThresholdMs from a saved group. */
export function useRemoveStaleTabs() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, staleThresholdMs }: { groupIndex: number; staleThresholdMs: number }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const g = { ...available[groupIndex] };
        const now = Date.now();
        g.windows = g.windows
          .map((w) => ({ ...w, tabs: w.tabs.filter((t) => !t.savedAt || now - t.savedAt <= staleThresholdMs) }))
          /** keep the last window even when empty — a group with zero windows is an invalid state */
          .filter((w) => w.tabs.length > 0 || g.windows.length === 1);
        g.updatedAt = now;
        g.pendingSync = true;
        g.info = getGroupInfo(g);
        available[groupIndex] = g;
        return { ...prev, available };
      })
  });
}

export function useArchiveGroup() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const group = available[groupIndex];
        if (!group || group.permanent) return prev;
        available[groupIndex] = { ...group, archived: true, updatedAt: Date.now(), pendingSync: true };
        return { ...prev, available };
      })
  });
}

export function useRestoreGroup() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) =>
      mutate((prev) => {
        const available = [...prev.available];
        const group = available[groupIndex];
        if (!group) return prev;
        available[groupIndex] = { ...group, archived: false, updatedAt: Date.now(), pendingSync: true };
        return { ...prev, available };
      })
  });
}

/**
 * Writes a reminder `{ fireAt, note }` to a tab in IndexedDB, persists the URL metadata to
 * `chrome.storage.local`, and delegates alarm registration to the background script via message.
 * Alarms are only available in background context — the popup must send `CREATE_ALARM` to create them.
 */
export function useSetTabReminder() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: async ({
      groupIndex,
      windowIndex,
      tabIndex,
      fireAt,
      note
    }: {
      groupIndex: number;
      windowIndex: number;
      tabIndex: number;
      fireAt: number;
      note?: string;
    }) => {
      // Store URL in chrome.storage.local so background can open it without popup
      const state = await mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        const tabs = [...windows[windowIndex].tabs];
        tabs[tabIndex] = { ...tabs[tabIndex], reminder: { fireAt, note: note || undefined } };
        windows[windowIndex] = { ...windows[windowIndex], tabs };
        available[groupIndex] = { ...available[groupIndex], windows, updatedAt: Date.now(), pendingSync: true };
        return { ...prev, available };
      }, true); // ponytail: skip undo for reminder — ephemeral user intent, not structural

      // Register the alarm — background will fire the notification
      const tab = state.available[groupIndex]?.windows[windowIndex]?.tabs[tabIndex];
      if (!tab) return;
      const alarmName = `reminder-${tab.id}-${groupIndex}-${windowIndex}-${tabIndex}`;
      await chrome.storage.local.set({
        [alarmName]: { url: tab.url, title: tab.title, note: note || '' }
      });
      const delayInMinutes = Math.max(1, (fireAt - Date.now()) / 60_000);
      // chrome.alarms only available in background — delegate via message
      chrome.runtime.sendMessage({ type: 'CREATE_ALARM', name: alarmName, delayInMinutes });
    }
  });
}

export function useClearTabReminder() {
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
      // Capture tab id before mutate removes the reminder field
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const tabId = state?.available[groupIndex]?.windows[windowIndex]?.tabs[tabIndex]?.id ?? '';

      await mutate((prev) => {
        const available = [...prev.available];
        const windows = [...available[groupIndex].windows];
        const tabs = [...windows[windowIndex].tabs];
        const { reminder: _r, ...rest } = tabs[tabIndex];
        tabs[tabIndex] = rest as typeof tabs[number];
        windows[windowIndex] = { ...windows[windowIndex], tabs };
        available[groupIndex] = { ...available[groupIndex], windows, updatedAt: Date.now(), pendingSync: true };
        return { ...prev, available };
      }, true);

      // Best-effort alarm + storage cleanup; alarms only in background
      const alarmName = `reminder-${tabId}-${groupIndex}-${windowIndex}-${tabIndex}`;
      chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: alarmName }).catch(() => {});
      chrome.storage.local.remove(alarmName).catch(() => {});
    }
  });
}

/**
 * Applies AI auto-group suggestions: for each `{ name, color, tabIds }`, creates a new
 * saved group containing the matching live tabs (matched by real Chrome tab id, since
 * Now Open's tabs — unlike saved-tab copies — carry real ids, not the `id:0` sentinel)
 * and removes them from the Now Open snapshot. The browser tabs themselves are left open —
 * `useCurrentTabs` will re-sync them into Now Open on the next tick, same as any other
 * Now Open → saved move (see `useMoveTab`).
 */
export function useApplyAIGroups() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    // Returns how many groups/tabs were actually created — a suggestion whose tabIds
    // don't match any live Now Open tab (e.g. a stale AI response) is silently skipped
    // by the loop below, so the caller can't infer success from suggestions.length alone.
    mutationFn: async (suggestions: { name: string; color: string; tabIds: number[] }[]) => {
      // Bail before touching mutate() (no undo snapshot, no IDB write) if nothing will match
      const nowOpenIds = new Set(
        (qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available[0]?.windows ?? []).flatMap((w) =>
          w.tabs.map((t) => t.id)
        )
      );
      if (!suggestions.some((s) => s.tabIds.some((id) => nowOpenIds.has(id)))) {
        return { appliedGroups: 0, appliedTabs: 0 };
      }

      let appliedGroups = 0;
      let appliedTabs = 0;

      await mutate((prev) => {
        const available = [...prev.available];
        const nowOpen = { ...available[0] };
        let windows = nowOpen.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));
        const now = Date.now();
        const newGroups: Group[] = [];

        for (const suggestion of suggestions) {
          const idSet = new Set(suggestion.tabIds);
          const movedTabs: Tab[] = [];
          windows = windows.map((w) => {
            const [keep, taken] = [w.tabs.filter((t) => !idSet.has(t.id)), w.tabs.filter((t) => idSet.has(t.id))];
            movedTabs.push(...taken.map((t) => ({ ...t, id: 0, savedAt: now })));
            return { ...w, tabs: keep };
          });
          if (movedTabs.length === 0) continue;

          const group = createGroup(nanoid(10), suggestion.name, suggestion.color);
          group.windows = [createWindow(movedTabs)];
          group.info = getGroupInfo(group);
          newGroups.push(group);
          appliedGroups++;
          appliedTabs += movedTabs.length;
        }

        // Drop emptied windows, but never let Now Open end up with zero windows
        const finalWindows = windows.filter((w) => w.tabs.length > 0);
        nowOpen.windows = finalWindows.length > 0 ? finalWindows : windows.slice(0, 1);
        available[0] = nowOpen;

        return { ...prev, available: [...available, ...newGroups] };
      });

      return { appliedGroups, appliedTabs };
    }
  });
}

/** Imports groups and appends them (preserving Now Open at index 0). */
export function useImportGroups() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (newGroups: import('@/lib/types').Group[]) =>
      mutate((prev) => ({
        ...prev,
        available: [...prev.available, ...newGroups]
      }))
  });
}
