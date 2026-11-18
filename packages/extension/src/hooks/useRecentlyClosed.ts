import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RECENTLY_CLOSED_MESSAGE, RECENTLY_CLOSED_UNDO_TOAST_MS as UNDO_TOAST_MS } from '@tabmerger/shared';
import { isOpenableUrl } from '@/lib/safeOpen';
import { closeTabs, closeWindows } from '@/lib/closeLiveTabs';
import { APP_SETTINGS_QUERY_KEY, type AppSettings } from '@/hooks/useAppSettings';
import { useEntitlements } from '@/hooks/useEntitlements';
import { entriesShownForPlan, type ClosedTab, type RecentlyClosedEntry, type RecentlyClosedPlan } from '@/lib/recentlyClosed';
import { trimRecentlyClosedIfFree } from '@/lib/recentlyClosedPlan';
import { groupEntriesByDay, localDayKey, type RecentlyClosedDay } from '@/lib/recentlyClosedDays';
import {
  deleteRecentlyClosedEntries,
  getRecentlyClosedEntries,
  markRecentlyClosedCleared,
  notifyRecentlyClosedChanged,
  putRecentlyClosedEntries,
  setRememberClosedTabs,
  unmarkRecentlyClosedCleared
} from '@/lib/recentlyClosedDb';

/**
 * "Recently closed tabs": the popup's data API. The background worker records closes
 * (lib/recentlyClosedRecorder.ts); this reads the list and changes it. No UI here.
 *
 * Reading:
 *   const { entries, days, plan, isLoading } = useRecentlyClosed();
 *   // what the plan lists (entriesShownForPlan): on Free only the newest 2 days that have closes,
 *   // so every consumer (day rows and their count, day view, Ctrl+K, Settings) shows the same list.
 *   // days: newest first, each { key: 'YYYY-MM-DD', kind, label, color, start, end, entries,
 *   // tabCount, windowCount, allTabCount } (see RecentlyClosedDay in lib/recentlyClosedDays.ts).
 *   // `color` is the day's fixed colour (colorForDay): same every time, different from the next day.
 *
 * Changing (TanStack mutations; every one that removes something resolves a RecentlyClosedUndo to
 * hand to useUndoRecentlyClosed for the toast's Undo):
 *   useReopenRecentlyClosed()        reopen a tab entry, restore a window entry, or reopen one tab of a window
 *   useRemoveRecentlyClosedEntry()   remove entries from the list ({ ids })
 *   useRemoveRecentlyClosedDay()     remove a whole day ({ day: 'YYYY-MM-DD' })
 *   useClearRecentlyClosed()         clear the whole list
 *   useSetRememberClosedTabs()       the Settings switch; turning it off also clears the list
 *   useUndoRecentlyClosed()          undo any of the above
 *
 * Removing and clearing only MARK entries (`clearedAt`): they disappear at once and the worker
 * deletes them about 60 s later. Show the Undo toast for RECENTLY_CLOSED_UNDO_TOAST_MS (9 s): the
 * long delete delay covers a toast Sonner paused (hovered, or the page hidden). If Undo still comes
 * too late, useUndoRecentlyClosed resolves `{ complete: false }`: tell the user the entries could not
 * be brought back. Nothing here touches the groups, the undo stack or sync.
 */

export const RECENTLY_CLOSED_QUERY_KEY = ['recentlyClosed'] as const;

/** How long an Undo toast for a reopen, removal or clear stays up (well inside the 60 s delete delay). */
export const RECENTLY_CLOSED_UNDO_TOAST_MS = UNDO_TOAST_MS;

/** What a reopen or a removal did, so it can be undone. Opaque to the UI: pass it to {@link useUndoRecentlyClosed}. */
export type RecentlyClosedUndo =
  | { kind: 'unmark'; ids: string[]; turnBackOn?: boolean }
  | { kind: 'restore'; entries: RecentlyClosedEntry[]; openedTabIds: number[]; openedWindowId?: number };

/** A tab or window that could not be opened (the browser refused the URL). The entry is kept. */
export class RecentlyClosedOpenError extends Error {
  constructor(message = 'recently-closed-open-failed') {
    super(message);
    this.name = 'RecentlyClosedOpenError';
  }
}

/** Invalidates the list here and tells the other extension pages (and the worker, for clears). */
function changed(qc: QueryClient, cleared = false): void {
  void qc.invalidateQueries({ queryKey: RECENTLY_CLOSED_QUERY_KEY });
  notifyRecentlyClosedChanged();
  if (!cleared || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    // the worker deletes marked entries once the undo window has passed
    chrome.runtime.sendMessage({ type: RECENTLY_CLOSED_MESSAGE.CLEARED }, () => void chrome.runtime.lastError);
  } catch {
    // worker unreachable: it deletes them at its next start
  }
}

/**
 * The plan the popup lists recently closed tabs for: `free` once `useEntitlements` says Free (not
 * while it loads), else `pro`/`unknown` (everything stored). Display only: pruning storage needs a
 * confirmed answer (see {@link useTrimRecentlyClosedForPlan}).
 */
export function useRecentlyClosedPlan(): RecentlyClosedPlan {
  const { tier, loading } = useEntitlements();
  if (loading) return 'unknown';
  return tier === 'free' ? 'free' : 'pro';
}

/**
 * The recently-closed list as the plan shows it: `entries` (newest first, cleared ones left out)
 * and `days` (grouped by local day, labelled in the UI language), both limited by
 * `entriesShownForPlan` (Free: the newest `recentDays` days that have closes, the days its prune
 * keeps), and the `plan` they were limited for. `staleTime: Infinity` (local data); refetched when
 * the worker records a close (`RECENTLY_CLOSED_CHANGED`) and after every change made here.
 */
export function useRecentlyClosed() {
  const qc = useQueryClient();
  const { i18n } = useTranslation();
  const plan = useRecentlyClosedPlan();
  const query = useQuery({
    queryKey: RECENTLY_CLOSED_QUERY_KEY,
    queryFn: () => getRecentlyClosedEntries(),
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const onMessage = (msg: unknown) => {
      if ((msg as { type?: unknown } | null | undefined)?.type !== RECENTLY_CLOSED_MESSAGE.CHANGED) return;
      void qc.invalidateQueries({ queryKey: RECENTLY_CLOSED_QUERY_KEY });
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [qc]);

  const stored = query.data;
  const language = i18n.language;
  const entries = useMemo(() => (stored ? entriesShownForPlan(stored, plan) : []), [stored, plan]);
  const days: RecentlyClosedDay[] = useMemo(() => groupEntriesByDay(entries, Date.now(), language), [entries, language]);
  return { ...query, entries, days, plan };
}

/**
 * Catches storage up with the Free list: once the popup shows Free (`useRecentlyClosedPlan`), the
 * stored list is pruned to the Free limits ONCE per mount, through `trimRecentlyClosedIfFree`,
 * which prunes only when the server confirms Free (never while the plan loads, never on `unknown`,
 * never on the Free `useEntitlements` reports when its read failed). Without it, entries kept under
 * the Pro limits (recorded while the plan was unknown, or under an older rule) stayed stored until
 * the worker's next start or recorded close. Mounted once, by the sidebar section.
 */
export function useTrimRecentlyClosedForPlan(): void {
  const qc = useQueryClient();
  const plan = useRecentlyClosedPlan();
  const done = useRef(false);
  useEffect(() => {
    if (plan !== 'free' || done.current) return;
    done.current = true;
    trimRecentlyClosedIfFree()
      .then((deleted) => {
        if (deleted > 0) void qc.invalidateQueries({ queryKey: RECENTLY_CLOSED_QUERY_KEY });
      })
      .catch((err: unknown) => console.warn('[TabMerger] recently closed trim failed:', err));
  }, [plan, qc]);
}

async function popupWindowId(): Promise<number | undefined> {
  try {
    const win = await chrome.windows.getCurrent();
    return typeof win?.id === 'number' && win.id >= 0 ? win.id : undefined;
  } catch {
    return undefined;
  }
}

/** Re-pins and rebuilds the browser tab groups of a restored window. Best effort: the window is already open. */
async function restoreTabState(tabs: ClosedTab[], openedIds: (number | undefined)[], windowId: number): Promise<void> {
  const pinned = openedIds.filter((id, i): id is number => typeof id === 'number' && tabs[i]?.pinned === true);
  await Promise.all(pinned.map((id) => chrome.tabs.update(id, { pinned: true }).catch(() => undefined)));
  if (typeof chrome.tabs.group !== 'function' || typeof chrome.tabGroups?.update !== 'function') return;
  // consecutive unpinned tabs with the same group title and colour form one group
  const runs: { tabIds: number[]; group: NonNullable<ClosedTab['tabGroup']> }[] = [];
  tabs.forEach((tab, i) => {
    const id = openedIds[i];
    if (!tab.tabGroup || tab.pinned || typeof id !== 'number') return;
    const last = runs[runs.length - 1];
    const prevTab = tabs[i - 1];
    if (last && prevTab?.tabGroup && !prevTab.pinned && prevTab.tabGroup.title === tab.tabGroup.title && prevTab.tabGroup.color === tab.tabGroup.color) {
      last.tabIds.push(id);
    } else {
      runs.push({ tabIds: [id], group: tab.tabGroup });
    }
  });
  for (const run of runs) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: run.tabIds as [number, ...number[]], createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, { title: run.group.title, color: run.group.color as chrome.tabGroups.Color });
    } catch {
      // grouping is cosmetic: the tabs are open either way
    }
  }
}

export interface ReopenRecentlyClosedInput {
  entry: RecentlyClosedEntry;
  /**
   * For a window entry: reopen only this tab (its position in `entry.tabs`) in `windowId`; the rest
   * stay in the list as the same window entry. Omitted: a tab entry reopens its tab, a window entry
   * restores the whole window.
   */
  tabIndex?: number;
  /** Window to open a tab in. Defaults to the popup's own window. Ignored for a whole window. */
  windowId?: number;
  /** Focus the opened tab/window (default `true`); `false` for Ctrl/Cmd or middle click. */
  active?: boolean;
}

/**
 * Reopens an entry: a new tab at the URL (no back/forward history, that is the browser's own
 * restore), or a whole window with its pinned tabs and tab groups rebuilt. Container tabs
 * (Firefox) reopen in the default container. The entry leaves the list once the browser opened it;
 * if the browser refuses the URL the mutation rejects with {@link RecentlyClosedOpenError} and the
 * entry stays (show an error toast). Resolves a {@link RecentlyClosedUndo} (Undo closes what was
 * opened, quietly, and puts the entry back).
 */
export function useReopenRecentlyClosed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entry, tabIndex, windowId, active = true }: ReopenRecentlyClosedInput): Promise<RecentlyClosedUndo> => {
      const single = entry.kind === 'tab' ? entry.tabs[0] : tabIndex !== undefined ? entry.tabs[tabIndex] : undefined;
      if (single) {
        if (!isOpenableUrl(single.url)) throw new RecentlyClosedOpenError();
        const target = windowId ?? (await popupWindowId());
        let opened: chrome.tabs.Tab;
        try {
          opened = await chrome.tabs.create({ url: single.url, active, ...(target !== undefined ? { windowId: target } : {}), ...(single.pinned ? { pinned: true } : {}) });
        } catch {
          throw new RecentlyClosedOpenError();
        }
        const openedTabIds = typeof opened?.id === 'number' ? [opened.id] : [];
        if (entry.kind === 'tab') {
          await deleteRecentlyClosedEntries([entry.id]);
        } else {
          // one tab out of a window entry: the window keeps the rest
          const rest = entry.tabs.filter((_, i) => i !== tabIndex);
          await putRecentlyClosedEntries([{ ...entry, kind: rest.length > 1 ? 'window' : 'tab', tabs: rest }]);
        }
        changed(qc);
        return { kind: 'restore', entries: [entry], openedTabIds };
      }

      const tabs = entry.tabs.filter((tab) => isOpenableUrl(tab.url));
      if (tabs.length === 0) throw new RecentlyClosedOpenError();
      let win: chrome.windows.Window | undefined;
      try {
        win = await chrome.windows.create({ url: tabs.map((tab) => tab.url), focused: active });
      } catch {
        throw new RecentlyClosedOpenError();
      }
      if (!win || typeof win.id !== 'number') throw new RecentlyClosedOpenError();
      const openedIds = (win.tabs ?? []).map((tab) => tab.id);
      await restoreTabState(tabs, openedIds, win.id);
      await deleteRecentlyClosedEntries([entry.id]);
      changed(qc);
      return { kind: 'restore', entries: [entry], openedTabIds: [], openedWindowId: win.id };
    }
  });
}

/** Marks entries cleared and resolves the undo. */
async function clearEntries(
  qc: QueryClient,
  target: { ids: readonly string[] } | { day: string } | 'all',
  opts: { turnOff?: boolean } = {}
): Promise<RecentlyClosedUndo & { kind: 'unmark' }> {
  let ids: readonly string[] | 'all';
  if (target === 'all') ids = 'all';
  else if ('day' in target) ids = (await getRecentlyClosedEntries()).filter((e) => localDayKey(e.closedAt) === target.day).map((e) => e.id);
  else ids = target.ids;
  const marked = ids === 'all' || ids.length > 0 ? await markRecentlyClosedCleared(ids, Date.now(), opts) : [];
  if (marked.length > 0) changed(qc, true);
  return { kind: 'unmark', ids: marked };
}

/** Removes entries from the list (`{ ids }`). Resolves the undo; `ids` in it is what was removed (empty: nothing was). */
export function useRemoveRecentlyClosedEntry() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ ids }: { ids: readonly string[] }) => clearEntries(qc, { ids }) });
}

/** Removes every entry of one local day (`{ day: RecentlyClosedDay['key'] }`). Resolves the undo. */
export function useRemoveRecentlyClosedDay() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ day }: { day: string }) => clearEntries(qc, { day }) });
}

/** "Clear list": every entry. Resolves the undo; `ids.length` is how many were cleared (for the toast). */
export function useClearRecentlyClosed() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => clearEntries(qc, 'all') });
}

/** Mirrors the switch into the Settings cache (`useAppSettings` exposes it as `rememberClosedTabs`). */
function cacheRememberSetting(qc: QueryClient, on: boolean): void {
  qc.setQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY, (prev) => (prev ? { ...prev, rememberClosedTabs: on } : prev));
}

/**
 * The "Remember closed tabs" switch. Saved at once in the recently-closed store's own meta row
 * (one transaction; the worker re-reads it inside every recording). Turning it OFF stops recording
 * and clears the list in ONE transaction: the resolved undo turns it back on and brings the entries
 * back. Turning it on resolves `null` (nothing to undo).
 */
export function useSetRememberClosedTabs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean): Promise<(RecentlyClosedUndo & { kind: 'unmark' }) | null> => {
      if (on) {
        await setRememberClosedTabs(true);
        cacheRememberSetting(qc, true);
        return null;
      }
      const undo = await clearEntries(qc, 'all', { turnOff: true });
      cacheRememberSetting(qc, false);
      return { ...undo, turnBackOn: true };
    }
  });
}

/**
 * Undoes a reopen, a removal, a clear or turning the setting off. Resolves `{ complete }`: `false`
 * when some cleared entries were already deleted (the Undo came after the worker's delete delay), so
 * the UI can say the list could not be fully brought back. Turning the setting back on happens
 * either way.
 */
export function useUndoRecentlyClosed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (undo: RecentlyClosedUndo): Promise<{ complete: boolean }> => {
      let complete = true;
      if (undo.kind === 'unmark') {
        if (undo.turnBackOn) {
          await setRememberClosedTabs(true);
          cacheRememberSetting(qc, true);
        }
        const restored = await unmarkRecentlyClosedCleared(undo.ids);
        complete = restored >= undo.ids.length;
      } else {
        await putRecentlyClosedEntries(undo.entries);
        // what the reopen opened goes away again, without being recorded as a new close
        if (undo.openedWindowId !== undefined) await closeWindows(undo.openedWindowId, { record: false }).catch(() => {});
        if (undo.openedTabIds.length > 0) await closeTabs(undo.openedTabIds, { record: false }).catch(() => {});
      }
      changed(qc);
      return { complete };
    }
  });
}
