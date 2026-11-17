import { useTranslation } from 'react-i18next';
import {
  RECENTLY_CLOSED_UNDO_TOAST_MS,
  RecentlyClosedOpenError,
  useClearRecentlyClosed,
  useRemoveRecentlyClosedDay,
  useRemoveRecentlyClosedEntry,
  useReopenRecentlyClosed,
  useUndoRecentlyClosed,
  type RecentlyClosedUndo
} from '@/hooks/useRecentlyClosed';
import { useSaveClosedToGroup } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed';
import type { RecentlyClosedDay } from '@/lib/recentlyClosedDays';
import { ClosedSaveTargetGoneError, type ClosedSaveTarget } from '@/lib/recentlyClosedSave';
import { FreeLimitExceededError } from '@/lib/tierLimits';
import { announceSectionView } from '@/lib/sectionViewStatus';
import { trackEvent } from '@/lib/analytics';
import { toast } from '@/lib/toast';
import { getUrlDisplay } from '@/lib/savedTab';

/** A short name for an entry in toasts and announcements: a tab's title (else its address), or "Window · 6 tabs". */
export function useEntryName(): (entry: RecentlyClosedEntry, tabIndex?: number) => string {
  const { t } = useTranslation();
  return (entry, tabIndex) => {
    const tab = entry.kind === 'tab' ? entry.tabs[0] : tabIndex !== undefined ? entry.tabs[tabIndex] : undefined;
    if (tab) return tab.title || getUrlDisplay(tab.url) || tab.url;
    return t('recentlyClosed.entry.window', { tabs: t('common.tabCount', { count: entry.tabs.length }) });
  };
}

/**
 * The toast id of the plain confirmations (saved, link copied), so repeating one replaces it. Undo
 * toasts get no id: Sonner does not show a new toast under the id of one it is still dismissing (an
 * Undo click dismisses it), so a quick second action would show nothing.
 */
const ACTION_TOAST_ID = 'recently-closed-action';

/**
 * The feedback every change to the list gives: `done(message, ...undoTokens)` shows a toast with
 * Undo (9 s; Undo takes back every token in order and says when the entries were already deleted)
 * and puts the same text in the status line; `failed(err)` shows the error toast (the entry stays
 * when the browser refused the address) and resolves `false`. Everything runs through
 * `mutateAsync`, so an Undo still works after the component that showed the toast unmounted (the
 * search overlay closes as soon as a result is picked).
 */
function useRecentlyClosedFeedback() {
  const { t } = useTranslation();
  const { mutateAsync: undo } = useUndoRecentlyClosed();

  /** The toast's Undo: takes back every step in order (a "Reopen all" is a reopen plus a removal). */
  const undoAction = (tokens: RecentlyClosedUndo[]) => ({
    label: t('header.undo'),
    onClick: () => {
      void (async () => {
        try {
          let complete = true;
          for (const token of tokens) complete = (await undo(token)).complete && complete;
          if (!complete) toast.error(t('recentlyClosed.errors.undoIncomplete'));
        } catch {
          toast.error(t('recentlyClosed.errors.changeFailed'));
        }
      })();
    }
  });

  const done = (message: string, ...tokens: RecentlyClosedUndo[]) => {
    announceSectionView(message);
    toast.success(message, { duration: RECENTLY_CLOSED_UNDO_TOAST_MS, action: undoAction(tokens) });
  };

  const failed = (err: unknown): false => {
    toast.error(t(err instanceof RecentlyClosedOpenError ? 'recentlyClosed.errors.openFailed' : 'recentlyClosed.errors.changeFailed'));
    return false;
  };

  return { done, failed };
}

/**
 * Reopens a closed entry with the list's feedback: a tab entry, a whole window entry, or (with
 * `tabIndex`) one tab of a window entry; `background` (Ctrl/Cmd or middle click) opens it without
 * focus. Toast "Reopened <title>" / "Restored a window with N tabs" with Undo, the error toast when
 * the browser refuses the address, and `recently_closed_reopened { kind, from }` where `kind` is
 * what actually opened (`tab` for one tab of a window). Used by the day view (`from: 'list'`) and
 * the Ctrl+K overlay (`from: 'search'`). Resolves `true` when it opened.
 */
export function useReopenClosedEntry(from: 'list' | 'search') {
  const { t } = useTranslation();
  const nameOf = useEntryName();
  const { mutateAsync: reopenEntry } = useReopenRecentlyClosed();
  const { done, failed } = useRecentlyClosedFeedback();

  return async (entry: RecentlyClosedEntry, { tabIndex, background = false }: { tabIndex?: number; background?: boolean } = {}) => {
    // a tab entry has one tab: an index there means nothing
    const index = entry.kind === 'window' ? tabIndex : undefined;
    try {
      const token = await reopenEntry({ entry, tabIndex: index, active: !background });
      const wholeWindow = entry.kind === 'window' && index === undefined;
      trackEvent('recently_closed_reopened', { kind: wholeWindow ? 'window' : 'tab', from });
      done(
        wholeWindow
          ? t('recentlyClosed.toast.restoredWindow', { tabs: t('common.tabCount', { count: entry.tabs.length }) })
          : t('recentlyClosed.toast.reopened', { title: nameOf(entry, index) }),
        token
      );
      return true;
    } catch (err) {
      return failed(err);
    }
  };
}

/**
 * Everything the Recently closed section and day view do to the list, with the feedback the spec
 * asks for: a toast with Undo (9 s) after a reopen, removal or clear, the same text in the status
 * line, an error toast that keeps the entry when the browser refuses a URL, and analytics events
 * that never carry a URL, title or site. "Save to group…" goes through `useGroups`, so Free
 * limits, `pendingSync`, sync and undo work as for any save; the entry stays in the list.
 * Each action resolves `true` when it did what was asked (the caller moves focus then).
 */
export function useRecentlyClosedActions() {
  const { t } = useTranslation();
  const nameOf = useEntryName();
  const { maxGroups, maxTabs } = useEntitlements();
  const { mutateAsync: reopenEntry } = useReopenRecentlyClosed();
  const { mutateAsync: removeEntries } = useRemoveRecentlyClosedEntry();
  const { mutateAsync: removeDayEntries } = useRemoveRecentlyClosedDay();
  const { mutateAsync: clearAllEntries } = useClearRecentlyClosed();
  const { mutateAsync: saveClosed } = useSaveClosedToGroup({ maxGroups, maxTabs });
  const { done, failed } = useRecentlyClosedFeedback();
  /** Reopens a tab entry, restores a window entry, or (with `tabIndex`) reopens one tab of a window. */
  const reopen = useReopenClosedEntry('list');

  /**
   * "Reopen all in a new window": every tab of the day in one new window (pinned tabs and tab
   * groups rebuilt, as a window restore), then the day leaves the list. Undo closes that window and
   * brings the day back.
   */
  const reopenAll = async (day: RecentlyClosedDay) => {
    const tabs = day.entries.flatMap((e) => e.tabs);
    if (tabs.length === 0) return false;
    // never stored: the reopen's own delete of this id finds nothing, the day is removed below
    const combined: RecentlyClosedEntry = { id: `day-${day.key}`, closedAt: day.start, kind: 'window', tabs };
    try {
      const token = await reopenEntry({ entry: combined });
      const removal = await removeDayEntries({ day: day.key });
      // what opened is one window (the analytics `kind` is what actually opened)
      trackEvent('recently_closed_reopened', { kind: 'window', from: 'list' });
      // Undo closes the window but must not store the combined entry: the day's own entries come back
      const closeWindow: RecentlyClosedUndo = token.kind === 'restore' ? { ...token, entries: [] } : token;
      done(t('recentlyClosed.toast.reopenedAll', { tabs: t('common.tabCount', { count: tabs.length }) }), closeWindow, removal);
      return true;
    } catch (err) {
      return failed(err);
    }
  };

  /** "Remove from list" for one entry. */
  const remove = async (entry: RecentlyClosedEntry) => {
    try {
      const token = await removeEntries({ ids: [entry.id] });
      if (token.ids.length === 0) return false;
      done(t('recentlyClosed.toast.removed', { name: nameOf(entry) }), token);
      return true;
    } catch (err) {
      return failed(err);
    }
  };

  /** Removes a whole day (the sidebar row's button, the view's "Remove this day"). */
  const removeDay = async (day: RecentlyClosedDay) => {
    try {
      const token = await removeDayEntries({ day: day.key });
      if (token.ids.length === 0) return false;
      done(t('recentlyClosed.toast.cleared', { count: token.ids.length }), token);
      return true;
    } catch (err) {
      return failed(err);
    }
  };

  /** "Clear all recently closed": the whole list, as Settings' Clear list. */
  const clearAll = async () => {
    try {
      const token = await clearAllEntries();
      if (token.ids.length === 0) return false;
      trackEvent('recently_closed_cleared');
      done(t('recentlyClosed.toast.cleared', { count: token.ids.length }), token);
      return true;
    } catch (err) {
      return failed(err);
    }
  };

  /**
   * "Save to group…": `entries` into a saved group or a new group named after the site. `kind` is
   * for analytics only (`tab`, `window`, or `day` for "Save all"). The entries stay in the list.
   */
  const saveToGroup = async (entries: readonly RecentlyClosedEntry[], target: ClosedSaveTarget, kind: 'tab' | 'window' | 'day', groupName: string) => {
    try {
      await saveClosed({ entries, target });
      trackEvent('recently_closed_saved', { kind });
      const message = t('recentlyClosed.toast.saved', { group: groupName });
      announceSectionView(message);
      toast.success(message, { id: ACTION_TOAST_ID });
      return true;
    } catch (err) {
      // the Free-limit backstop already showed the upgrade toast
      if (err instanceof FreeLimitExceededError) return false;
      toast.error(t(err instanceof ClosedSaveTargetGoneError ? 'recentlyClosed.errors.groupGone' : 'recentlyClosed.errors.changeFailed'));
      return false;
    }
  };

  /** "Copy link" (tab rows only). */
  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('recentlyClosed.toast.linkCopied'), { id: ACTION_TOAST_ID });
    } catch {
      toast.error(t('recentlyClosed.toast.copyFailed'));
    }
  };

  return { reopen, reopenAll, remove, removeDay, clearAll, saveToGroup, copyLink };
}
