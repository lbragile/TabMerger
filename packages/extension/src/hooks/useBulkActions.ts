/**
 * Bulk action hooks for selection mode.
 * All operations use the same IndexedDB-first mutation pattern as useGroups.ts.
 */
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';
import { useUIStore } from '@/stores/uiStore';
import type { SelectedItem } from '@/stores/uiStore';
import { GROUPS_QUERY_KEY, RESTRICTED_URL_RE } from '@/hooks/useGroups';
import { createWindow, getGroupInfo, sortWindowsByStarred } from '@/lib/utils';
import { deleteRemoteGroups } from '@/lib/syncEngine';
import { resolveIncognito } from '@/lib/incognito';
import { deleteRulesForGroupIds } from '@/hooks/useUrlRules';
import type { Tab, Window as WindowType } from '@/lib/types';

// ─── ID Parsers ───────────────────────────────────────────────────────────────

interface ParsedTab { groupIndex: number; windowIndex: number; tabIndex: number }
interface ParsedWindow { groupIndex: number; windowIndex: number }
interface ParsedGroup { groupIndex: number }

function parseTabId(id: string): ParsedTab | null {
  const m = id.match(/^tab-(\d+)-(\d+)-(\d+)$/);
  return m ? { groupIndex: +m[1], windowIndex: +m[2], tabIndex: +m[3] } : null;
}

function parseWindowId(id: string): ParsedWindow | null {
  const m = id.match(/^window-(\d+)-(\d+)$/);
  return m ? { groupIndex: +m[1], windowIndex: +m[2] } : null;
}

export function parseGroupId(id: string): ParsedGroup | null {
  const m = id.match(/^group-(\d+)$/);
  return m ? { groupIndex: +m[1] } : null;
}

// ─── Bulk Delete ──────────────────────────────────────────────────────────────

/**
 * Delete all selected items of the same type.
 * Handles cascade: closes live browser tabs, removes from IndexedDB.
 */
export function useBulkDelete() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);
  const exitSelectionMode = useUIStore((s) => s.exitSelectionMode);
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);

  return useMutation({
    mutationFn: async (items: SelectedItem[]): Promise<{ type: SelectedItem['type'] | null }> => {
      if (items.length === 0) return { type: null };
      const type = items[0].type;

      const state = await qc.fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState });
      pushUndo(state);

      if (type === 'tab') {
        // Sort DESC so index removal doesn't shift lower indices
        const parsed = items
          .map((i) => parseTabId(i.id))
          .filter((p): p is ParsedTab => p !== null)
          .sort((a, b) =>
            b.groupIndex !== a.groupIndex ? b.groupIndex - a.groupIndex
              : b.windowIndex !== a.windowIndex ? b.windowIndex - a.windowIndex
              : b.tabIndex - a.tabIndex
          );

        // Fire-and-forget close browser tabs
        const tabIds = parsed.flatMap((p) => {
          const t = state.available[p.groupIndex]?.windows[p.windowIndex]?.tabs[p.tabIndex];
          return t?.id ? [t.id] : [];
        });
        if (tabIds.length > 0) chrome.tabs.remove(tabIds).catch(() => {});

        // Deep-clone the mutable part: each group's windows + tabs arrays
        const available = state.available.map((g) => ({
          ...g,
          windows: g.windows.map((w) => ({ ...w, tabs: [...w.tabs] }))
        }));

        for (const p of parsed) {
          const grp = available[p.groupIndex];
          if (!grp) continue;
          const windows = grp.windows;
          const win = windows[p.windowIndex];
          if (!win) continue;
          win.tabs.splice(p.tabIndex, 1);
          // Auto-close empty window only when the group has more than one window
          if (win.tabs.length === 0 && windows.length > 1) {
            available[p.groupIndex] = {
              ...grp,
              windows: windows.filter((_, i) => i !== p.windowIndex)
            };
          }
        }

        // Mark all affected groups as updated
        const affectedGroups = new Set(parsed.map((p) => p.groupIndex));
        const finalAvailable = available.map((g, i) =>
          affectedGroups.has(i)
            ? { ...g, updatedAt: Date.now(), pendingSync: true, info: getGroupInfo(g) }
            : g
        );

        const next = { ...state, available: finalAvailable };
        await saveGroupsState(next);
        qc.setQueryData(GROUPS_QUERY_KEY, next);

      } else if (type === 'window') {
        const parsed = items
          .map((i) => parseWindowId(i.id))
          .filter((p): p is ParsedWindow => p !== null)
          // DESC so removing higher windowIndex doesn't shift lower
          .sort((a, b) =>
            b.groupIndex !== a.groupIndex ? b.groupIndex - a.groupIndex : b.windowIndex - a.windowIndex
          );

        const tabIds = parsed.flatMap((p) => {
          const win = state.available[p.groupIndex]?.windows[p.windowIndex];
          return win?.tabs.map((t) => t.id) ?? [];
        });
        if (tabIds.length > 0) chrome.tabs.remove(tabIds).catch(() => {});

        const available = state.available.map((g) => ({ ...g, windows: [...g.windows] }));

        for (const p of parsed) {
          const grp = available[p.groupIndex];
          if (!grp) continue;
          const updated = {
            ...grp,
            windows: grp.windows.filter((_, i) => i !== p.windowIndex),
            updatedAt: Date.now(),
            pendingSync: true
          };
          updated.info = getGroupInfo(updated);
          available[p.groupIndex] = updated;
        }

        const next = { ...state, available };
        await saveGroupsState(next);
        qc.setQueryData(GROUPS_QUERY_KEY, next);

      } else if (type === 'group') {
        const parsed = items
          .map((i) => parseGroupId(i.id))
          .filter((p): p is ParsedGroup => p !== null)
          // DESC so removing higher indices doesn't shift lower ones
          .sort((a, b) => b.groupIndex - a.groupIndex);

        let available = [...state.available];
        const deletedGroupIds: string[] = [];

        for (const p of parsed) {
          const group = available[p.groupIndex];
          if (!group || group.permanent) continue;
          const tabIds = group.windows.flatMap((w) => w.tabs.map((t) => t.id));
          if (tabIds.length > 0) chrome.tabs.remove(tabIds).catch(() => {});
        }

        for (const p of parsed) {
          const group = available[p.groupIndex];
          if (!group || group.permanent) continue;
          deletedGroupIds.push(group.id);
          available = available.filter((_, i) => i !== p.groupIndex);
        }

        // Fire-and-forget: hard-delete from Supabase so sync doesn't resurrect these on reload
        deleteRemoteGroups(deletedGroupIds).catch(() => {});
        deleteRulesForGroupIds(deletedGroupIds).catch(() => {});

        const next = {
          ...state,
          available,
          active: { id: available[0]?.id ?? '', index: 0 }
        };
        await saveGroupsState(next);
        qc.setQueryData(GROUPS_QUERY_KEY, next);
      }

      return { type };
    },

    onSuccess: (data) => {
      exitSelectionMode();
      // After group deletion the active index may be stale — always reset to 0
      if (data.type === 'group') {
        setActiveGroupIndex(0);
      }
    }
  });
}

// ─── Bulk Move to Group ───────────────────────────────────────────────────────

/**
 * Move all selected tabs or windows to a target group.
 * Groups cannot be moved to another group — that case is a no-op.
 */
export function useBulkMoveToGroup() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);
  const exitSelectionMode = useUIStore((s) => s.exitSelectionMode);

  return useMutation({
    mutationFn: async ({
      items,
      targetGroupIndex
    }: {
      items: SelectedItem[];
      targetGroupIndex: number;
    }) => {
      if (items.length === 0) return;
      const type = items[0].type;
      if (type === 'group') return; // Moving groups into groups is not supported

      const state = await qc.fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState });
      pushUndo(state);

      // Deep-clone so we can mutate in-place
      const available = state.available.map((g) => ({
        ...g,
        windows: g.windows.map((w) => ({ ...w, tabs: [...w.tabs] }))
      }));

      if (type === 'tab') {
        const parsedDesc = items
          .map((i) => parseTabId(i.id))
          .filter((p): p is ParsedTab => p !== null)
          .sort((a, b) =>
            b.groupIndex !== a.groupIndex ? b.groupIndex - a.groupIndex
              : b.windowIndex !== a.windowIndex ? b.windowIndex - a.windowIndex
              : b.tabIndex - a.tabIndex
          );

        // Collect tabs in ASC order (natural reading order) before mutating
        const parsedAsc = [...parsedDesc].reverse();
        const tabsToMoveWithSource = parsedAsc
          .map((p) => ({
            tab: state.available[p.groupIndex]?.windows[p.windowIndex]?.tabs[p.tabIndex],
            sourceKey: `${p.groupIndex}:${p.windowIndex}`
          }))
          .filter((t): t is { tab: Tab; sourceKey: string } => t.tab !== undefined);
        const tabsToMove: Tab[] = tabsToMoveWithSource.map((t) => t.tab);

        // Remove from source positions in DESC order (avoids index drift)
        // Now Open (permanent) sources are copies — never remove from them
        const affectedSourceGroups = new Set<number>();
        for (const p of parsedDesc) {
          const grp = available[p.groupIndex];
          if (!grp || grp.permanent) continue;
          const win = grp.windows[p.windowIndex];
          if (!win) continue;
          win.tabs.splice(p.tabIndex, 1);
          if (win.tabs.length === 0 && grp.windows.length > 1) {
            available[p.groupIndex] = {
              ...grp,
              windows: grp.windows.filter((_, i) => i !== p.windowIndex)
            };
          }
          affectedSourceGroups.add(p.groupIndex);
        }

        if (available[targetGroupIndex]?.permanent) {
          // Moving to Now Open → open each tab in the browser; useCurrentTabs will sync them in
          for (const tab of tabsToMove) {
            if (tab.url && !RESTRICTED_URL_RE.test(tab.url)) {
              chrome.tabs.create({ url: tab.url, active: false }).catch(() => {});
            }
          }
          // Don't insert into Now Open IndexedDB — the sync handles it
        } else {
          // Group tabs by their original source window so tabs that were
          // together stay together as one window in the target group
          const bySource = new Map<string, Tab[]>();
          for (const { tab, sourceKey } of tabsToMoveWithSource) {
            const bucket = bySource.get(sourceKey);
            if (bucket) bucket.push(tab);
            else bySource.set(sourceKey, [tab]);
          }
          const newWindows = [...bySource.values()].map((tabs) => createWindow(tabs));
          const targetGrp = available[targetGroupIndex];
          available[targetGroupIndex] = {
            ...targetGrp,
            windows: sortWindowsByStarred([...newWindows, ...targetGrp.windows]),
            updatedAt: Date.now(),
            pendingSync: true
          };
          available[targetGroupIndex].info = getGroupInfo(available[targetGroupIndex]);
        }

        // Refresh info + timestamps for source groups
        for (const gi of affectedSourceGroups) {
          if (gi === targetGroupIndex) continue;
          available[gi] = {
            ...available[gi],
            updatedAt: Date.now(),
            pendingSync: true,
            info: getGroupInfo(available[gi])
          };
        }

      } else if (type === 'window') {
        const parsedDesc = items
          .map((i) => parseWindowId(i.id))
          .filter((p): p is ParsedWindow => p !== null)
          .sort((a, b) =>
            b.groupIndex !== a.groupIndex ? b.groupIndex - a.groupIndex : b.windowIndex - a.windowIndex
          );

        // Collect windows in ASC order before mutating
        const parsedAsc = [...parsedDesc].reverse();
        const windowsToMove: WindowType[] = parsedAsc
          .map((p) => state.available[p.groupIndex]?.windows[p.windowIndex])
          .filter((w): w is WindowType => w !== undefined);

        // Remove from source positions in DESC order
        // Now Open (permanent) sources are copies — never remove from them
        const affectedSourceGroups = new Set<number>();
        for (const p of parsedDesc) {
          const grp = available[p.groupIndex];
          if (!grp || grp.permanent) continue;
          available[p.groupIndex] = {
            ...grp,
            windows: grp.windows.filter((_, i) => i !== p.windowIndex)
          };
          affectedSourceGroups.add(p.groupIndex);
        }

        if (available[targetGroupIndex]?.permanent) {
          // Moving to Now Open → open each window in the browser; useCurrentTabs will sync them in
          for (const win of windowsToMove) {
            const urls = win.tabs.map((t) => t.url).filter((u) => u && !RESTRICTED_URL_RE.test(u));
            if (urls.length > 0) {
              void resolveIncognito(win.incognito).then((incognito) =>
                chrome.windows.create(incognito ? { url: urls, focused: false, incognito: true } : { url: urls, focused: false })
              ).catch(() => {});
            }
          }
          // Don't insert into Now Open IndexedDB — the sync handles it
        } else {
          // Add windows to target group
          const targetGrp = available[targetGroupIndex];
          available[targetGroupIndex] = {
            ...targetGrp,
            windows: sortWindowsByStarred([...windowsToMove, ...targetGrp.windows]),
            updatedAt: Date.now(),
            pendingSync: true
          };
          available[targetGroupIndex].info = getGroupInfo(available[targetGroupIndex]);
        }

        // Refresh info + timestamps for source groups
        for (const gi of affectedSourceGroups) {
          if (gi === targetGroupIndex) continue;
          available[gi] = {
            ...available[gi],
            updatedAt: Date.now(),
            pendingSync: true,
            info: getGroupInfo(available[gi])
          };
        }
      }

      const next = { ...state, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    },

    onSuccess: () => exitSelectionMode()
  });
}

// ─── Bulk Star ────────────────────────────────────────────────────────────────

export function useBulkStar() {
  const qc = useQueryClient();
  const pushUndo = useUIStore((s) => s.pushUndo);
  const exitSelectionMode = useUIStore((s) => s.exitSelectionMode);

  return useMutation({
    mutationFn: async ({ items, starred }: { items: SelectedItem[]; starred: boolean }) => {
      if (items.length === 0) return;
      const state = await qc.fetchQuery({ queryKey: GROUPS_QUERY_KEY, queryFn: getGroupsState });
      pushUndo(state);

      const available = state.available.map((g) => ({ ...g, windows: [...g.windows] }));
      const type = items[0].type;

      if (type === 'window') {
        for (const item of items) {
          const p = parseWindowId(item.id);
          if (!p) continue;
          const grp = available[p.groupIndex];
          if (!grp) continue;
          const win = grp.windows[p.windowIndex];
          if (!win) continue;
          grp.windows[p.windowIndex] = { ...win, starred };
        }
        for (const grp of available) {
          if (!grp) continue;
          const idx = available.indexOf(grp);
          available[idx] = { ...grp, windows: sortWindowsByStarred(grp.windows), updatedAt: Date.now(), pendingSync: true };
        }
      } else if (type === 'group') {
        for (const item of items) {
          const p = parseGroupId(item.id);
          if (!p) continue;
          const grp = available[p.groupIndex];
          if (!grp || grp.permanent) continue;
          available[p.groupIndex] = { ...grp, starred, updatedAt: Date.now(), pendingSync: true };
        }
      }

      const next = { ...state, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    },
    onSuccess: () => exitSelectionMode()
  });
}
