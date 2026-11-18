import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { WindowsPanel } from '@/components/Windows';
import type { GroupsState } from '@/lib/types';
import { useUIStore, type MainView } from '@/stores/uiStore';
import { useSessions } from '@/hooks/useSessions';
import { ArchivedGroupView } from './ArchivedGroupView';
import { SessionView } from './SessionView';
import { ClosedDayView } from './ClosedDayView';
import { useRecentlyClosed } from '@/hooks/useRecentlyClosed';
import { RECENTLY_CLOSED_SECTION_ATTR } from '@/lib/sidebarSections';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import { announceSectionView, clearSectionViewStatus } from '@/lib/sectionViewStatus';

const GROUP_VIEW_FALLBACK: MainView = { kind: 'group' };

/**
 * Where focus goes when a view closed and took the focused control with it: the sidebar row that
 * opened the view, else the group row now shown, else the view's section toggle.
 */
function focusAfterViewClosed(view: MainView, activeGroupIndex: number): void {
  const opener =
    view.kind === 'archived'
      ? `[data-archived-open="${CSS.escape(view.groupId)}"]`
      : view.kind === 'session'
        ? `[data-session-open="${CSS.escape(view.sessionId)}"]`
        : view.kind === 'closedDay'
          ? `[data-closed-day-open="${CSS.escape(view.day)}"]`
          : null;
  const section =
    view.kind === 'closedDay'
      ? `[${RECENTLY_CLOSED_SECTION_ATTR}]`
      : `[data-tour="${view.kind === 'archived' ? TOUR_ANCHORS.archived : TOUR_ANCHORS.sessions}"]`;
  const target =
    (opener ? document.querySelector<HTMLElement>(opener) : null) ??
    document.querySelector<HTMLElement>(`[data-sidebar-group-index="${activeGroupIndex}"]`) ??
    document.querySelector<HTMLElement>(`${section} [data-sidebar-section-toggle]`);
  target?.focus();
}

/**
 * The main panel: the active group's windows (`WindowsPanel`), or the read-only view a sidebar
 * section row opened (`uiStore.mainView`). A view whose archived group, session or recently-closed
 * day is gone (deleted or restored here, from the sidebar, or by sync from another device; undone;
 * every entry of the day reopened or removed) falls back to the
 * group shown before it opened. Coming back to the group view with focus lost (its ✕ or the view
 * itself unmounted) puts focus back on the row that opened the view, else that group's sidebar row
 * (`focusAfterViewClosed`). While a view is open the polite status line says so.
 */
export function MainPanel({ groupsState }: { groupsState: GroupsState }) {
  const { t } = useTranslation();
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  // (a store without the field, as some test mocks are, is the group view)
  const mainView = useUIStore((s) => s.mainView) ?? GROUP_VIEW_FALLBACK;
  const closeMainView = useUIStore((s) => s.closeMainView);
  const { data: storedSessions } = useSessions();
  const { days, isLoading: closedLoading } = useRecentlyClosed();
  const groups = groupsState.available;

  const archivedIndex = mainView.kind === 'archived' ? groups.findIndex((g) => g.id === mainView.groupId && g.archived && !g.permanent) : -1;
  // Automatic backups are never listed as sessions (Settings → Data owns them)
  const session = mainView.kind === 'session' ? storedSessions?.find((s) => s.id === mainView.sessionId && s.auto !== true) : undefined;
  const closedDay = mainView.kind === 'closedDay' ? days.find((d) => d.key === mainView.day) : undefined;
  // Sessions (or the recently-closed list) still loading are not "gone"
  const gone =
    (mainView.kind === 'archived' && archivedIndex < 0) ||
    (mainView.kind === 'session' && !!storedSessions && !session) ||
    (mainView.kind === 'closedDay' && !closedLoading && !closedDay);

  useEffect(() => {
    if (gone) closeMainView(groups);
  }, [gone, groups, closeMainView]);

  const lastView = useRef<MainView>(GROUP_VIEW_FALLBACK);
  const groupView = mainView.kind === 'group';
  useEffect(() => {
    const closed = lastView.current;
    lastView.current = mainView;
    if (!groupView || closed.kind === 'group') return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    focusAfterViewClosed(closed, activeGroupIndex);
  }, [groupView, mainView, activeGroupIndex]);

  // "Showing … read-only" while a view is open; cleared when it closes (unless replaced meanwhile)
  const showing =
    archivedIndex >= 0
      ? t('sidePanel.view.showingArchived', { name: groups[archivedIndex].name })
      : session
        ? t('sidePanel.view.showingSession', { name: session.name })
        : closedDay
          ? t('recentlyClosed.view.showing', { context: closedDay.kind, day: closedDay.label })
          : '';
  useEffect(() => {
    if (!showing) return;
    announceSectionView(showing);
    return () => clearSectionViewStatus(showing);
  }, [showing]);

  if (archivedIndex >= 0) {
    return <ArchivedGroupView group={groups[archivedIndex]} groupIndex={archivedIndex} groups={groups} />;
  }
  if (session) return <SessionView session={session} groups={groups} />;
  // keyed by day: "Show more" starts over on another day
  if (closedDay) return <ClosedDayView key={closedDay.key} day={closedDay} days={days} groups={groups} />;

  const activeGroup = groups[activeGroupIndex] ?? groups[0];
  if (!activeGroup) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('common.noGroupSelected')}</div>;
  }
  return <WindowsPanel group={activeGroup} groupIndex={groups.indexOf(activeGroup)} allGroups={groups} />;
}
