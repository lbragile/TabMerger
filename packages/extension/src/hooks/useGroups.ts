import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { nanoid } from 'nanoid';
import type { Group, GroupsState, Tab } from '@/lib/types';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from '@/lib/types';
import { getGroupsState, saveGroupsState, updateGroupsState } from '@/lib/localDb';
import { deleteRemoteGroups } from '@/lib/syncEngine';
import { resolveIncognito } from '@/lib/incognito';
import { deleteRulesForGroupIds } from '@/hooks/useUrlRules';
import { createGroup, createWindow, sortWindowsByStarred, getGroupInfo } from '@/lib/utils';
import { copyLiveWindow } from '@/lib/dndMove';
import { getSidebarDisplayOrder } from '@/lib/sidebarOrder';
import { asNewGroup } from '@/lib/syncDirty';
import { alignToBase, restoreFreshOrder, markAborted, wasAborted } from '@/lib/groupsAlign';
import { toast } from '@/lib/toast';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';
import { type TierCaps, FreeLimitExceededError, countSavedGroupsAndTabs, exceedsFreeLimits, showFreeLimitToast } from '@/lib/tierLimits';

/**
 * Free-tier backstop shared by every group-creating mutation below (`useAddGroup`,
 * `useDuplicateGroup`, `useApplyAIGroups`). Same pattern as `useSaveUrlRules(maxUrlRules)`:
 * `caps` is a HOOK-level param (default `{}`, i.e. ungated) rather than part of the mutation
 * payload, so existing callers/tests that don't pass it are completely unaffected, and the
 * mutation's payload shape never has to change. Reads the QueryClient cache (not a fresh
 * fetch) — same tradeoff `useDeleteGroup`/`useDeleteWindow` already make for their
 * live-tab-closing precheck — so an empty/stale cache just skips the check rather than
 * blocking (there's nothing reliable to gate against yet).
 * Throws (rather than returning a sentinel) so the mutation's promise rejects and the
 * write never happens — callers that don't await/catch simply see the mutation fail.
 */
function assertWithinFreeLimits(
  cached: GroupsState | undefined,
  caps: TierCaps,
  addedGroups: number,
  addedTabs: number
): void {
  if (!cached) return;
  const current = countSavedGroupsAndTabs(cached.available);
  const check = exceedsFreeLimits(caps, { groups: current.groups + addedGroups, tabs: current.tabs + addedTabs });
  if (check.exceeded) {
    showFreeLimitToast(check.limit, check.maxAllowed);
    throw new FreeLimitExceededError(check.limit);
  }
}

export const GROUPS_QUERY_KEY = ['groups'] as const;

/** Saved (non-permanent) tabs that predate the `savedAt` field. */
function tabsMissingSavedAt(state: GroupsState): Tab[] {
  return state.available
    .filter((g) => !g.permanent)
    .flatMap((g) => g.windows.flatMap((w) => w.tabs))
    .filter((t) => !t.savedAt);
}

async function getGroupsStateWithMigration() {
  const state = await getGroupsState();
  if (tabsMissingSavedAt(state).length === 0) return state;
  // Redo the migration as an atomic update on a fresh read, so it can't overwrite a write
  // (this context's or the service worker's) that landed after the read above.
  return updateGroupsState((fresh) => {
    const missing = tabsMissingSavedAt(fresh);
    if (missing.length === 0) return null;
    const now = Date.now();
    missing.forEach((t) => { t.savedAt = now; });
    return fresh;
  });
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
 * Pattern: atomic IDB read-modify-write (`updateGroupsState`: fresh read → optionally push undo
 * snapshot → apply transform → persist, all inside the write queue + cross-context lock) → update cache.
 * Pass `skipUndo=true` for operations that are too granular to undo (notes, info fields, Now Open sync).
 * `mutFn` runs inside the lock: keep it synchronous and cheap (fire-and-forget side effects only).
 */
function useGroupsMutation() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);

  return (mutFn: (prev: GroupsState) => GroupsState, skipUndo = false, opts: { align?: boolean } = {}) => {
    // The list the user is looking at. `mutFn` closes over positional indexes from that render.
    const base = opts.align === false ? undefined : qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
    /** a fresh read inside the lock (not the cache) guarantees we mutate the latest IDB state, even one the service worker just wrote */
    let gone = false;
    return updateGroupsState((fresh) => {
      // Resolve the target by group id: re-address the fresh state to `base`'s order so index N
      // is still the group the user clicked; refuse (no write) if that group is gone.
      const prev = alignToBase(base, fresh);
      if (!prev) {
        gone = true;
        return null;
      }
      if (!skipUndo) pushUndo(prev);
      const result = mutFn(prev);
      // The view was in the user's order: put the result back into the FRESH order (see restoreFreshOrder).
      return prev === fresh ? result : restoreFreshOrder(fresh, prev, result);
    }).then((next) => {
      if (gone) {
        toast.info('A group you were working on changed or was removed elsewhere, so nothing was changed.', { id: 'groups-changed-elsewhere' });
        markAborted(next); // onSuccess analytics must not count a mutation that did nothing
      }
      qc.setQueryData(GROUPS_QUERY_KEY, next);
      return next;
    });
  };
}

/** `caps` (default `{}` = ungated) is the Free-tier backstop — see `assertWithinFreeLimits`. */
export function useAddGroup(caps: TierCaps = {}) {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ name, color }: { name?: string; color?: string }) => {
      assertWithinFreeLimits(qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY), caps, 1, 0);
      return mutate((prev) => {
        const newGroup = createGroup(nanoid(10), name, color ?? DEFAULT_GROUP_COLOR);
        return { ...prev, available: [...prev.available, newGroup] };
      }, false, { align: false });
    },
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
      }).then((next) => {
        if (target && !target.permanent) deleteRulesForGroupIds([target.id]).catch(() => {});
        return next;
      });
    },
    // `cancelRefetch: false` is MANDATORY on the groups key (spec C11). The default
    // (`true`) CANCELS an in-flight groups fetch, and TanStack rejects every promise
    // joined to it — including any `fetchQuery`/mutation a concurrent user action is
    // awaiting, which silently loses that action. Refetch by joining, never by cancelling.
    onSuccess: () => qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false })
  });
}

/** `caps` (default `{}` = ungated) is the Free-tier backstop — see `assertWithinFreeLimits`. */
export function useDuplicateGroup(caps: TierCaps = {}) {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) => {
      const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const source = cached?.available[groupIndex];
      const sourceTabs = source ? source.windows.reduce((sum, w) => sum + w.tabs.length, 0) : 0;
      assertWithinFreeLimits(cached, caps, 1, sourceTabs);
      return mutate((prev) => {
        const { available } = prev;
        const source = available[groupIndex];
        if (!source) return prev;

        // new identity: no inherited server base / position flag (see asNewGroup)
        const clone: Group = asNewGroup(
          { ...JSON.parse(JSON.stringify(source)), name: DEFAULT_GROUP_TITLE, permanent: false, updatedAt: Date.now() },
          nanoid(10)
        );

        const newAvailable = [...available];
        newAvailable.splice(groupIndex + 1, 0, clone);
        return { ...prev, available: newAvailable };
      });
    }
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
    onSuccess: (data) => { if (!wasAborted(data)) trackEvent('group_renamed'); }
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

        // An emptied window is KEPT (user rule, 2026-09-18 — this reverses the old
        // "auto-close the source window" behaviour). An empty window card still renders,
        // still counts in the badges and is still a drop target, so removing a window is
        // always an explicit action. `dndMove` keeps them for the same reason.
        windows[windowIndex] = { ...windows[windowIndex], tabs };
        const updatedWindows = windows;

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

/**
 * Sorts tabs alphabetically by title or URL. Scope depends on whether `windowIndex` is
 * given:
 * - **omitted** (both group-level call sites: the windows-toolbar ⋯ and
 *   `GroupContextMenu`) — sorts every window in the group. Unchanged from before
 *   `windowIndex` existed.
 * - **provided** (the per-window ⋯ menu in `Window.tsx`) — sorts only that one window's
 *   tabs; sibling windows in the group are left byte-identical.
 */
export function useSortTabs() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ groupIndex, windowIndex, by }: { groupIndex: number; windowIndex?: number; by: 'title' | 'url' }) =>
      mutate((prev) => {
        const available = [...prev.available];
        const sortTabsOf = (w: (typeof available)[number]['windows'][number]) => ({
          ...w,
          tabs: [...w.tabs].sort((a, b) => {
            const aVal = by === 'title' ? (a.title ?? '') : (a.url ?? '');
            const bVal = by === 'title' ? (b.title ?? '') : (b.url ?? '');
            return aVal.localeCompare(bVal);
          })
        });
        const windows =
          windowIndex === undefined
            ? available[groupIndex].windows.map(sortTabsOf)
            : available[groupIndex].windows.map((w, i) => (i === windowIndex ? sortTabsOf(w) : w));
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
          // An emptied source window is KEPT (user rule, 2026-09-18).
          fromGroup.windows = fromWindows;
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

          // An emptied source window is KEPT (user rule, 2026-09-18).
          fromGroup.windows = fromWindows;
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
 * A Now Open source is always a COPY (same rule as `useMoveTab`'s `copy`): the target gets a
 * detached saved copy and Now Open is left untouched, so the real window stays open.
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
          if (urls.length > 0) {
            void resolveIncognito(win.incognito).then((incognito) =>
              chrome.windows.create(incognito ? { url: urls, focused: false, incognito: true } : { url: urls, focused: false })
            ).catch(() => {});
          }
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

        let movedWindow;
        if (available[fromGroupIndex].permanent) {
          // Now Open source ("Copy to group"): the live window stays where it is and stays open.
          const liveWindow = available[fromGroupIndex].windows[windowIndex];
          if (!liveWindow) return prev;
          movedWindow = copyLiveWindow(liveWindow);
        } else {
          // Remove window from source group
          const fromGroup = { ...available[fromGroupIndex] };
          const fromWindows = [...fromGroup.windows];
          [movedWindow] = fromWindows.splice(windowIndex, 1);
          fromGroup.windows = fromWindows;
          fromGroup.updatedAt = Date.now();
          fromGroup.pendingSync = true;
          fromGroup.info = getGroupInfo(fromGroup);
          available[fromGroupIndex] = fromGroup;
        }

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

  /**
   * `opts.expectedRev` (the rev of the cache state `state` was derived from) turns the write into
   * an optimistic-concurrency one: if another write landed since, nothing is written, the
   * groups are refetched and `false` is returned (the caller's snapshot is out of date).
   */
  return async (state: GroupsState, opts?: { expectedRev?: number }): Promise<boolean> => {
    try {
      const rev = await (opts ? saveGroupsState(state, opts) : saveGroupsState(state));
      qc.setQueryData(GROUPS_QUERY_KEY, typeof rev === 'number' ? { ...state, rev } : state);
      return true;
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== 'StaleGroupsError') throw err;
      void qc.invalidateQueries({ queryKey: GROUPS_QUERY_KEY }, { cancelRefetch: false });
      return false;
    }
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

/**
 * Archives a saved group. If the archived group was the active sidebar selection,
 * moves `activeGroupIndex` to the group directly ABOVE it in the sidebar's visible order
 * (see `getSidebarDisplayOrder` — starred-then-unstarred, Now Open always first), falling
 * back to Now Open (index 0) when the archived group was the topmost saved one. Archiving
 * never removes/reorders the group in `available` (only flips `archived`), so `realIndex`
 * values are stable across the mutation and can be computed from the pre-archive state.
 * If some OTHER group was active, `activeGroupIndex` is left untouched.
 */
export function useArchiveGroup() {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (groupIndex: number) => {
      const prevState = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      let aboveRealIndex = 0;
      if (prevState) {
        const order = getSidebarDisplayOrder(prevState.available);
        const pos = order.findIndex(({ realIndex }) => realIndex === groupIndex);
        aboveRealIndex = pos > 0 ? order[pos - 1].realIndex : 0;
      }

      return mutate((prev) => {
        const available = [...prev.available];
        const group = available[groupIndex];
        if (!group || group.permanent) return prev;
        available[groupIndex] = { ...group, archived: true, updatedAt: Date.now(), pendingSync: true };
        return { ...prev, available };
      }).then((next) => {
        // Only reindex if archiving actually happened (guards the permanent-group no-op
        // above) AND the archived group was the one the user was viewing.
        const didArchive = next.available[groupIndex]?.archived === true;
        if (didArchive && useUIStore.getState().activeGroupIndex === groupIndex) {
          useUIStore.getState().setActiveGroupIndex(aboveRealIndex);
        }
        return next;
      });
    }
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
 * Pure transform shared by `useApplyAIGroups`'s free-limit precheck (run against the cached
 * state, no side effects) and its actual `mutate()` transform (run against fresh IDB state)
 * — kept as one function so the two never drift apart.
 */
function applyAiSuggestionsToState(
  prev: GroupsState,
  suggestions: { name: string; color: string; tabIds: number[] }[]
): { nextAvailable: Group[]; appliedGroups: number; appliedTabs: number } {
  const available = [...prev.available];
  const nowOpen = { ...available[0] };
  let windows = nowOpen.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));
  const now = Date.now();
  const newGroups: Group[] = [];
  let appliedGroups = 0;
  let appliedTabs = 0;

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

  return { nextAvailable: [...available, ...newGroups], appliedGroups, appliedTabs };
}

/**
 * Applies AI auto-group suggestions: for each `{ name, color, tabIds }`, creates a new
 * saved group containing the matching live tabs (matched by real Chrome tab id, since
 * Now Open's tabs — unlike saved-tab copies — carry real ids, not the `id:0` sentinel)
 * and removes them from the Now Open snapshot. The browser tabs themselves are left open —
 * `useCurrentTabs` will re-sync them into Now Open on the next tick, same as any other
 * Now Open → saved move (see `useMoveTab`).
 *
 * `caps` (default `{}` = ungated) is the Free-tier backstop — see `assertWithinFreeLimits`.
 * `Header.tsx`'s AI-group flow already pre-clamps suggestions to the remaining group slots
 * before calling this, so the backstop here mainly guards the tab count (which isn't
 * pre-clamped) and any other future caller.
 */
export function useApplyAIGroups(caps: TierCaps = {}) {
  const qc = useQueryClient();
  const mutate = useGroupsMutation();

  return useMutation({
    // Returns how many groups/tabs were actually created — a suggestion whose tabIds
    // don't match any live Now Open tab (e.g. a stale AI response) is silently skipped
    // by the loop below, so the caller can't infer success from suggestions.length alone.
    mutationFn: async (suggestions: { name: string; color: string; tabIds: number[] }[]) => {
      const cached = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);

      // Bail before touching mutate() (no undo snapshot, no IDB write) if nothing will match
      const nowOpenIds = new Set(
        (cached?.available[0]?.windows ?? []).flatMap((w) => w.tabs.map((t) => t.id))
      );
      if (!suggestions.some((s) => s.tabIds.some((id) => nowOpenIds.has(id)))) {
        return { appliedGroups: 0, appliedTabs: 0 };
      }

      if (cached) {
        const preview = applyAiSuggestionsToState(cached, suggestions);
        assertWithinFreeLimits(cached, caps, preview.appliedGroups, preview.appliedTabs);
      }

      let appliedGroups = 0;
      let appliedTabs = 0;

      await mutate((prev) => {
        const result = applyAiSuggestionsToState(prev, suggestions);
        appliedGroups = result.appliedGroups;
        appliedTabs = result.appliedTabs;
        return { ...prev, available: result.nextAvailable };
      }, false, { align: false });

      return { appliedGroups, appliedTabs };
    }
  });
}

/**
 * Saves a batch of tabs (from a global keyboard shortcut) as a new window into an
 * existing group, or into a brand-new "Quick Save" group when `groupId` is omitted.
 * Mirrors background.ts's `appendTabsToGroup`, used when the picker modal isn't reachable.
 */
export function useSaveShortcutTabs() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: ({ tabs, groupId }: { tabs: Tab[]; groupId?: string }) =>
      mutate((prev) => {
        const available = [...prev.available];
        let targetIndex = groupId ? available.findIndex((g) => g.id === groupId && !g.permanent) : -1;

        if (targetIndex < 0 && !groupId) {
          available.push(createGroup(undefined, 'Quick Save'));
          targetIndex = available.length - 1;
        }
        if (targetIndex < 0) return prev;

        const group = { ...available[targetIndex] };
        group.windows = [...group.windows, createWindow(tabs)];
        group.updatedAt = Date.now();
        group.pendingSync = true;
        group.info = getGroupInfo(group);
        available[targetIndex] = group;
        return { ...prev, available };
      }, false, { align: false }),
    onSuccess: () => { trackEvent('tabs_saved', { count: 1 }); }
  });
}

/** Imports groups and appends them (preserving Now Open at index 0). */
export function useImportGroups() {
  const mutate = useGroupsMutation();

  return useMutation({
    mutationFn: (newGroups: import('@/lib/types').Group[]) =>
      mutate((prev) => ({
        ...prev,
        // each imported group is a new group (a backup made on this account repeats existing ids/stamps)
        available: [...prev.available, ...newGroups.map((g) => asNewGroup(g))]
      }), false, { align: false })
  });
}
