import { isOpenableUrl } from './safeOpen';
import { resolveIncognito } from './incognito';
import { closeLiveTabsSafely } from './closeLiveTabs';
import { keepTabsOpen } from './deferredTabClose';
import { noteTabsOpenedByPopup } from './ownOpenedTabs';
import type { GroupsState } from './types';

/**
 * Undo/redo for the REAL browser tabs a change closed or opened.
 *
 * An undo entry is a snapshot of the saved groups, and restoring it never touches "Now Open" (it
 * mirrors the browser). That is enough for a saved-to-saved change, but not for one that also
 * closed or opened real tabs:
 *  - a drag OUT of Now Open saves a copy and CLOSES the real tabs. Undo removes the copy, so it
 *    must also bring the tabs back, or they would be gone from everywhere;
 *  - a saved item dropped INTO Now Open is removed from its group and OPENED as real tabs. Undo
 *    puts the saved item back, so it also closes the tabs that drop opened.
 * Each such entry carries a {@link LiveTabsEffect}; running it returns the inverse effect, which is
 * attached to the entry the undo/redo pushed onto the other stack. So Redo closes exactly the tabs
 * Undo reopened (by the ids Chrome returned when reopening them), and Undo again reopens them.
 *
 * What it cannot do: a reopened tab is a NEW tab at the same URL, in the same window and position
 * when that window still exists (otherwise a new unfocused window). Its history, scroll position
 * and form contents are gone. A tab whose close the popup deferred (the active tab of the popup's
 * own window, closed when the popup goes away) is still open, so Undo simply keeps it open.
 *
 * Effects live in a WeakMap keyed by the history entry object, so they follow the entry wherever it
 * moves (a failed undo putting it back, the 10-entry cap dropping it) and go away with it.
 */

/** One real tab as an effect remembers it. `tabId` is the only identity ever used to close a tab. */
export interface LiveTabRecord {
  tabId: number;
  url: string;
  windowId?: number;
  index?: number;
  pinned?: boolean;
  incognito?: boolean;
}

export type LiveTabsEffect =
  /** tabs the change CLOSED: undoing it opens them again */
  | { kind: 'reopen'; tabs: LiveTabRecord[] }
  /** tabs the change OPENED: undoing it closes exactly these ids */
  | { kind: 'close'; tabs: LiveTabRecord[] };

const effects = new WeakMap<GroupsState, LiveTabsEffect>();

/** Attach `effect` to a history entry (nothing for a missing entry or an effect with no tabs). */
export function tagHistoryEntry(entry: GroupsState | undefined, effect: LiveTabsEffect | null | undefined): void {
  if (!entry || !effect || effect.tabs.length === 0) return;
  effects.set(entry, effect);
}

/** The effect attached to a history entry, if any. */
export function historyEntryEffect(entry: GroupsState | undefined): LiveTabsEffect | undefined {
  return entry ? effects.get(entry) : undefined;
}

/** Records of the live Now Open tabs with these ids in `state` (what a drag-out is about to close). */
export function liveTabRecords(state: GroupsState, tabIds: number[]): LiveTabRecord[] {
  const wanted = new Set(tabIds);
  const out: LiveTabRecord[] = [];
  for (const g of state.available) {
    if (!g.permanent) continue;
    for (const w of g.windows ?? []) {
      (w.tabs ?? []).forEach((t, index) => {
        if (t && wanted.has(t.id) && isOpenableUrl(t.url)) {
          out.push({ tabId: t.id, url: t.url, windowId: w.id, index, pinned: t.pinned === true, incognito: w.incognito === true });
        }
      });
    }
  }
  return out;
}

/** Run an effect against the browser. Resolves with its inverse (null when nothing happened). */
export async function runLiveTabsEffect(effect: LiveTabsEffect): Promise<LiveTabsEffect | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;
  try {
    if (effect.kind === 'reopen') {
      const tabs = await reopenTabs(effect.tabs);
      return tabs.length > 0 ? { kind: 'close', tabs } : null;
    }
    const tabs = await closeTabs(effect.tabs);
    return tabs.length > 0 ? { kind: 'reopen', tabs } : null;
  } catch {
    return null; // best effort: the saved data is already restored either way
  }
}

async function liveTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  try {
    return (await chrome.tabs.get(tabId)) ?? null;
  } catch {
    return null; // closed since
  }
}

async function windowExists(windowId: number | undefined): Promise<boolean> {
  if (typeof windowId !== 'number' || windowId < 0) return false;
  try {
    return !!(await chrome.windows.get(windowId));
  } catch {
    return false;
  }
}

/**
 * Opens the tabs again, unfocused and inactive (focusing a window or activating a tab in the
 * popup's window dismisses the popup). A tab that is still open (its close was deferred until
 * the popup closes) is kept open instead. Returns the tabs as they are now open, by their ids.
 */
async function reopenTabs(tabs: LiveTabRecord[]): Promise<LiveTabRecord[]> {
  const out: LiveTabRecord[] = [];
  const kept: number[] = [];
  const toOpen: LiveTabRecord[] = [];
  for (const t of tabs) {
    if (await liveTab(t.tabId)) {
      kept.push(t.tabId);
      out.push(t);
    } else if (isOpenableUrl(t.url)) {
      toOpen.push(t);
    }
  }
  keepTabsOpen(kept);

  // By original window, in tab order, so each tab goes back where it was
  const byWindow = new Map<number, LiveTabRecord[]>();
  toOpen.forEach((t) => {
    const key = t.windowId ?? -1;
    byWindow.set(key, [...(byWindow.get(key) ?? []), t]);
  });
  for (const [windowId, group] of byWindow) {
    const ordered = [...group].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (await windowExists(windowId)) {
      for (const t of ordered) {
        const created = await chrome.tabs.create({ windowId, url: t.url, index: t.index, active: false, pinned: t.pinned === true });
        noteTabsOpenedByPopup([{ id: created?.id, url: t.url }]);
        if (typeof created?.id === 'number') out.push({ ...t, tabId: created.id, windowId });
      }
    } else {
      const incognito = await resolveIncognito(ordered.some((t) => t.incognito));
      const urls = ordered.map((t) => t.url);
      const win = await chrome.windows.create(incognito ? { url: urls, focused: false, incognito: true } : { url: urls, focused: false });
      noteTabsOpenedByPopup((win?.tabs ?? []).map((t, i) => ({ id: t.id, url: urls[i] })));
      (win?.tabs ?? []).forEach((created, i) => {
        if (typeof created.id === 'number' && ordered[i]) out.push({ ...ordered[i], tabId: created.id, windowId: win?.id });
      });
    }
  }
  return out;
}

/**
 * Closes exactly the tabs with these ids, never another one: a tab already closed is skipped, and
 * so is one that no longer shows the URL it was opened with (the user navigated it, so it is
 * theirs now). Returns the tabs that were closed, for the inverse reopen.
 */
async function closeTabs(tabs: LiveTabRecord[]): Promise<LiveTabRecord[]> {
  const closing: LiveTabRecord[] = [];
  for (const t of tabs) {
    const live = await liveTab(t.tabId);
    if (!live || (live.url !== t.url && live.pendingUrl !== t.url)) continue;
    closing.push({
      ...t,
      windowId: live.windowId,
      index: live.index,
      pinned: live.pinned === true,
      incognito: live.incognito === true
    });
  }
  if (closing.length > 0) await closeLiveTabsSafely(closing.map((t) => t.tabId));
  return closing;
}
