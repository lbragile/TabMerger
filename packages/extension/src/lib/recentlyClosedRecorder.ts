import { nanoid } from 'nanoid';
import {
  RECENTLY_CLOSED_MESSAGE,
  RECENTLY_CLOSED_SNAPSHOT_DEBOUNCE_MS,
  RECENTLY_CLOSED_STORAGE_KEYS,
  RECENTLY_CLOSED_WINDOW_FLUSH_MS
} from '@tabmerger/shared';
import { getSetting, setSetting } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { fetchTier } from '@/lib/entitlementTier';
import { parseTierSeen } from '@/lib/autoSave';
import { isOwnExtensionPage } from '@/lib/messageSender';
import { APP_SETTINGS_KEY, AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys';
import {
  buildEntry,
  isQuietCloseKey,
  isQuietMarkFresh,
  isSnapshotChange,
  limitsForPlan,
  quietCloseTabKey,
  quietCloseWindowKey,
  readRememberClosedTabs,
  skipReason,
  snapshotFromTab,
  tabGroupOf,
  type ClosedTabGroup,
  type RecentlyClosedPlan,
  type SkipReason,
  type TabSnapshot
} from '@/lib/recentlyClosed';
import { addRecentlyClosedEntry, notifyRecentlyClosedChanged, pruneRecentlyClosed, purgeClearedRecentlyClosed } from '@/lib/recentlyClosedDb';

/**
 * The background worker's side of "Recently closed tabs" (spec: "Behaviour (background worker)").
 *
 * `tabs.onRemoved` only gives a tab id, so the worker keeps a snapshot of every open tab (url,
 * title, icon, pinned, window, private, position, browser tab group), mirrored to
 * `chrome.storage.session` so an evicted MV3 worker keeps it, and seeded from `tabs.query` when it
 * starts with none. A close is recorded unless the setting is off, the tab is private, its page is
 * not one to remember, or TabMerger closed it itself with its content safe elsewhere (a quiet-close
 * mark, see `closeTabs` in lib/closeLiveTabs.ts). The tabs of a closing window are buffered and
 * written as ONE window entry on `windows.onRemoved` (or 1 s after the last of them).
 *
 * Every event goes through one serial queue, so a window's last tab can't be buffered after the
 * window was already flushed. Writes run on their own queue (they may wait for the plan check).
 */

/** How long a plan answer is reused before it is looked up again (the worker rarely lives this long). */
const PLAN_MEMO_MS = 10 * 60 * 1000;
/** Debounce of a window's tab-position refresh after tabs move, open or attach. */
const INDEX_REFRESH_MS = 300;

/**
 * The plan to prune for, without a network request when one was remembered: nobody signed in on a
 * store no account owns is Free; otherwise the server's last answer (`AUTO_SAVE_TIER_SEEN_KEY`,
 * which auto-save keeps current), asking the server only when there is none. A failed check, an
 * account mismatch or a signed-out store that still holds an account's data is `unknown` (Pro limits).
 */
export async function resolveRecentlyClosedPlan(now: number = Date.now()): Promise<RecentlyClosedPlan> {
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data.session?.user.id ?? null;
  } catch {
    userId = null;
  }
  const owner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
  const remembered = parseTierSeen(await getSetting<unknown>(AUTO_SAVE_TIER_SEEN_KEY, null));
  const asPlan = (tier: string | null): RecentlyClosedPlan => (tier === 'free' ? 'free' : tier ? 'pro' : 'unknown');
  if (!userId) return owner ? asPlan(remembered) : 'free';
  if (owner && owner !== userId) return 'unknown';
  if (remembered) return asPlan(remembered);
  const tier = await fetchTier(userId);
  if (tier === null) return 'unknown';
  await setSetting(AUTO_SAVE_TIER_SEEN_KEY, { tier, at: now }).catch(() => {});
  return asPlan(tier);
}

export interface RecorderOptions {
  /** test seam */
  now?: () => number;
  /** test seam */
  resolvePlan?: () => Promise<RecentlyClosedPlan>;
  /** test seam */
  newId?: () => string;
}

interface WindowBuffer {
  snapshots: TabSnapshot[];
  closedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

function sessionArea(): chrome.storage.StorageArea | undefined {
  return typeof chrome === 'undefined' ? undefined : chrome.storage?.session;
}

/**
 * The recorder's state and event handlers, without wiring them to `chrome.*` events (that is
 * {@link registerRecentlyClosed}). Exported for tests: every handler resolves once its event is
 * fully handled, and `idle()` once every queued event AND write has finished.
 */
export function createRecentlyClosedRecorder(options: RecorderOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const newId = options.newId ?? (() => nanoid());
  const resolvePlanFn = options.resolvePlan ?? (() => resolveRecentlyClosedPlan(now()));

  const snapshots = new Map<number, TabSnapshot>();
  const buffers = new Map<number, WindowBuffer>();
  const indexTimers = new Map<number, ReturnType<typeof setTimeout>>();
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let purgeTimer: ReturnType<typeof setTimeout> | null = null;
  let plan: { value: RecentlyClosedPlan; at: number } | null = null;
  let eventChain: Promise<void> = Promise.resolve();
  let writeChain: Promise<void> = Promise.resolve();
  const pending = new Set<Promise<unknown>>();

  const track = <T>(p: Promise<T>): Promise<T> => {
    pending.add(p);
    void p.finally(() => pending.delete(p)).catch(() => {});
    return p;
  };

  /** Runs `task` after every earlier event. Never rejects (a failure is logged). */
  const onQueue = (task: () => Promise<void> | void): Promise<void> => {
    const run = eventChain.then(task).catch((err: unknown) => console.warn('[TabMerger] recently closed:', err));
    eventChain = run;
    return track(run);
  };

  const writeQueue = (task: () => Promise<void>): Promise<void> => {
    const run = writeChain.then(task).catch((err: unknown) => console.warn('[TabMerger] recently closed write failed:', err));
    writeChain = run;
    return track(run);
  };

  const persist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const area = sessionArea();
      if (!area?.set) return;
      const record = Object.fromEntries([...snapshots].map(([id, snap]) => [String(id), snap]));
      void Promise.resolve(area.set({ [RECENTLY_CLOSED_STORAGE_KEYS.snapshots]: record })).catch(() => {});
    }, RECENTLY_CLOSED_SNAPSHOT_DEBOUNCE_MS);
  };

  const groupOf = async (groupId: number | undefined): Promise<ClosedTabGroup | undefined> => {
    if (typeof groupId !== 'number' || groupId < 0 || typeof chrome.tabGroups?.get !== 'function') return undefined;
    try {
      return tabGroupOf(await chrome.tabGroups.get(groupId));
    } catch {
      return undefined;
    }
  };

  const put = async (tab: chrome.tabs.Tab, known?: ClosedTabGroup) => {
    const tabGroup = known ?? (await groupOf(tab.groupId));
    const snap = snapshotFromTab(tab, tabGroup);
    if (snap && typeof tab.id === 'number') snapshots.set(tab.id, snap);
  };

  /** Re-reads the tab positions of one window (debounced): orders the tabs of a closed window. */
  const refreshIndices = (windowId: number) => {
    if (typeof windowId !== 'number' || windowId < 0) return;
    const prev = indexTimers.get(windowId);
    if (prev) clearTimeout(prev);
    indexTimers.set(
      windowId,
      setTimeout(() => {
        indexTimers.delete(windowId);
        void onQueue(async () => {
          const tabs = await chrome.tabs.query({ windowId });
          for (const tab of tabs) {
            const snap = typeof tab.id === 'number' ? snapshots.get(tab.id) : undefined;
            if (snap && typeof tab.index === 'number') snapshots.set(tab.id!, { ...snap, index: tab.index, windowId });
          }
          persist();
        });
      }, INDEX_REFRESH_MS)
    );
  };

  /** Fills the cache: from session storage when the worker restarts, else (browser start) from the open tabs. */
  const load = async () => {
    const area = sessionArea();
    let stored: Record<string, unknown> = {};
    try {
      stored = ((await area?.get(null)) ?? {}) as Record<string, unknown>;
    } catch {
      stored = {};
    }
    const record = stored[RECENTLY_CLOSED_STORAGE_KEYS.snapshots];
    if (record && typeof record === 'object') {
      for (const [id, snap] of Object.entries(record as Record<string, TabSnapshot>)) {
        const tabId = Number(id);
        if (Number.isInteger(tabId) && snap && typeof snap.url === 'string' && typeof snap.windowId === 'number') snapshots.set(tabId, snap);
      }
    }
    // expired quiet-close marks (a close that never came) are dropped
    const t = now();
    const stale = Object.keys(stored).filter((key) => isQuietCloseKey(key) && !isQuietMarkFresh(stored[key], t));
    if (stale.length > 0) await Promise.resolve(area?.remove(stale)).catch(() => {});
    if (snapshots.size > 0) return;
    const [tabs, groups] = await Promise.all([
      chrome.tabs.query({}),
      typeof chrome.tabGroups?.query === 'function' ? chrome.tabGroups.query({}).catch(() => []) : Promise.resolve([] as chrome.tabGroups.TabGroup[])
    ]);
    const byId = new Map(groups.map((g) => [g.id, tabGroupOf(g)]));
    for (const tab of tabs) {
      const snap = snapshotFromTab(tab, typeof tab.groupId === 'number' ? byId.get(tab.groupId) : undefined);
      if (snap && typeof tab.id === 'number') snapshots.set(tab.id, snap);
    }
    persist();
  };

  const ready = onQueue(load);

  const currentPlan = async (): Promise<RecentlyClosedPlan> => {
    const t = now();
    if (plan && t - plan.at < PLAN_MEMO_MS) return plan.value;
    let value: RecentlyClosedPlan = 'unknown';
    try {
      value = await resolvePlanFn();
    } catch {
      value = 'unknown';
    }
    plan = { value, at: t };
    return value;
  };

  const schedulePurge = (at: number | null) => {
    if (at === null) return;
    if (purgeTimer) clearTimeout(purgeTimer);
    purgeTimer = setTimeout(() => {
      purgeTimer = null;
      void writeQueue(async () => {
        const { deleted, nextPurgeAt } = await purgeClearedRecentlyClosed(now());
        if (deleted > 0) notifyRecentlyClosedChanged();
        schedulePurge(nextPurgeAt);
      });
    }, Math.max(0, at - now()) + 50);
  };

  const write = (snaps: TabSnapshot[], closedAt: number) =>
    writeQueue(async () => {
      const entry = buildEntry(snaps, closedAt, newId());
      if (!entry) return;
      const limits = limitsForPlan(await currentPlan());
      if (await addRecentlyClosedEntry(entry, limits, now())) notifyRecentlyClosedChanged();
    });

  const flushWindow = (windowId: number) => {
    const buffer = buffers.get(windowId);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    buffers.delete(windowId);
    void write(buffer.snapshots, buffer.closedAt);
  };

  /** Reads and consumes the quiet-close marks for a tab (and its window's, which stays until the window is gone). */
  const isQuiet = async (tabId: number, windowId: number): Promise<boolean> => {
    const area = sessionArea();
    if (!area?.get) return false;
    const tabKey = quietCloseTabKey(tabId);
    const winKey = quietCloseWindowKey(windowId);
    let found: Record<string, unknown> = {};
    try {
      found = ((await area.get([tabKey, winKey])) ?? {}) as Record<string, unknown>;
    } catch {
      return false;
    }
    if (tabKey in found) await Promise.resolve(area.remove(tabKey)).catch(() => {});
    const t = now();
    return isQuietMarkFresh(found[tabKey], t) || isQuietMarkFresh(found[winKey], t);
  };

  /** Why the last handled close was skipped (`null` = recorded or buffered). Test seam. */
  let lastSkip: SkipReason | null = null;

  const handlers = {
    ready,
    snapshots,
    get lastSkip() {
      return lastSkip;
    },
    onCreated: (tab: chrome.tabs.Tab) =>
      onQueue(async () => {
        await put(tab);
        persist();
        if (typeof tab.windowId === 'number') refreshIndices(tab.windowId);
      }),
    onUpdated: (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      // `status` and the like fire all the time: only a real change to what is remembered counts
      if (!isSnapshotChange(changeInfo)) return Promise.resolve();
      return onQueue(async () => {
        const known = snapshots.get(tabId);
        // the group is looked up again only when the tab changed group
        const keepGroup = !('groupId' in changeInfo) && known?.groupId === tab.groupId ? known?.tabGroup : undefined;
        await put({ ...tab, id: tabId }, keepGroup);
        persist();
      });
    },
    onReplaced: (addedTabId: number, removedTabId: number) =>
      onQueue(async () => {
        const old = snapshots.get(removedTabId);
        snapshots.delete(removedTabId);
        if (old) snapshots.set(addedTabId, old);
        try {
          await put(await chrome.tabs.get(addedTabId));
        } catch {
          // gone already: the re-keyed snapshot stays
        }
        persist();
      }),
    onAttached: (tabId: number, info: { newWindowId: number; newPosition: number }) =>
      onQueue(() => {
        const snap = snapshots.get(tabId);
        if (snap) snapshots.set(tabId, { ...snap, windowId: info.newWindowId, index: info.newPosition });
        persist();
        refreshIndices(info.newWindowId);
      }),
    onMoved: (_tabId: number, info: { windowId: number }) =>
      onQueue(() => {
        refreshIndices(info.windowId);
      }),
    onTabGroupUpdated: (group: chrome.tabGroups.TabGroup) =>
      onQueue(() => {
        const tabGroup = tabGroupOf(group);
        let changed = false;
        for (const [id, snap] of snapshots) {
          if (snap.groupId !== group.id) continue;
          snapshots.set(id, { ...snap, ...(tabGroup ? { tabGroup } : {}) });
          changed = true;
        }
        if (changed) persist();
      }),
    onRemoved: (tabId: number, info: { windowId: number; isWindowClosing: boolean }) => {
      const closedAt = now();
      return onQueue(async () => {
        const snapshot = snapshots.get(tabId);
        snapshots.delete(tabId);
        persist();
        const quiet = await isQuiet(tabId, info.windowId);
        const enabled = readRememberClosedTabs(await getSetting<unknown>(APP_SETTINGS_KEY, null));
        lastSkip = skipReason({ enabled, snapshot, quiet });
        if (lastSkip || !snapshot) return;
        if (!info.isWindowClosing) {
          void write([snapshot], closedAt);
          return;
        }
        const buffer = buffers.get(info.windowId);
        if (buffer) clearTimeout(buffer.timer);
        const next: WindowBuffer = {
          snapshots: [...(buffer?.snapshots ?? []), snapshot],
          closedAt: buffer?.closedAt ?? closedAt,
          timer: setTimeout(() => void onQueue(() => flushWindow(info.windowId)), RECENTLY_CLOSED_WINDOW_FLUSH_MS)
        };
        buffers.set(info.windowId, next);
      });
    },
    onWindowRemoved: (windowId: number) =>
      onQueue(async () => {
        flushWindow(windowId);
        const area = sessionArea();
        await Promise.resolve(area?.remove(quietCloseWindowKey(windowId))).catch(() => {});
      }),
    /** Popup marked entries cleared: delete them once the undo window has passed. */
    onCleared: () =>
      writeQueue(async () => {
        const { nextPurgeAt } = await purgeClearedRecentlyClosed(now());
        schedulePurge(nextPurgeAt);
      }),
    /** Worker start: prune for the plan and delete cleared entries whose undo window passed while it slept. */
    sweep: () =>
      writeQueue(async () => {
        const limits = limitsForPlan(await currentPlan());
        const { deleted, nextPurgeAt } = await pruneRecentlyClosed(limits, now());
        if (deleted > 0) notifyRecentlyClosedChanged();
        schedulePurge(nextPurgeAt);
      }),
    /** Resolves when every queued event and write has finished (tests). */
    idle: async () => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    /** Test seam: stops every timer. */
    dispose: () => {
      if (persistTimer) clearTimeout(persistTimer);
      if (purgeTimer) clearTimeout(purgeTimer);
      for (const b of buffers.values()) clearTimeout(b.timer);
      for (const t of indexTimers.values()) clearTimeout(t);
      buffers.clear();
      indexTimers.clear();
    }
  };
  return handlers;
}

export type RecentlyClosedRecorder = ReturnType<typeof createRecentlyClosedRecorder>;

/**
 * Wires the recorder to the browser's events. Registered LAST in background.ts (after the badge,
 * URL-rule and auto-save listeners, which it never touches), so their listener indexes in the
 * tests stay the same. A missing API (no `tabGroups` on Firefox builds without it) is skipped.
 */
export function registerRecentlyClosed(): RecentlyClosedRecorder | null {
  if (typeof chrome === 'undefined' || !chrome.tabs?.onRemoved) return null;
  const recorder = createRecentlyClosedRecorder();
  chrome.tabs.onCreated.addListener((tab) => void recorder.onCreated(tab));
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => void recorder.onUpdated(tabId, changeInfo, tab));
  chrome.tabs.onReplaced?.addListener((added, removed) => void recorder.onReplaced(added, removed));
  chrome.tabs.onAttached?.addListener((tabId, info) => void recorder.onAttached(tabId, info));
  chrome.tabs.onMoved?.addListener((tabId, info) => void recorder.onMoved(tabId, info));
  chrome.tabs.onRemoved.addListener((tabId, info) => void recorder.onRemoved(tabId, info));
  chrome.windows?.onRemoved?.addListener((windowId) => void recorder.onWindowRemoved(windowId));
  chrome.tabGroups?.onUpdated?.addListener((group) => void recorder.onTabGroupUpdated(group));
  chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
    if ((msg as { type?: unknown } | null | undefined)?.type !== RECENTLY_CLOSED_MESSAGE.CLEARED) return;
    // only the extension's own pages (never a content script, see isOwnExtensionPage)
    if (!isOwnExtensionPage(sender)) return;
    void recorder.onCleared();
  });
  void recorder.ready.then(() => recorder.sweep());
  return recorder;
}
