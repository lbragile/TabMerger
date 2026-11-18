import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkPlus, RotateCcw, Trash2 } from 'lucide-react';
import { FREE_TIER_LIMITS, pickAutoColor } from '@tabmerger/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Group, Session } from '@/lib/types';
import { formatTimeAgo } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { cn, getSessionCounts } from '@/lib/utils';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import { useUIStore } from '@/stores/uiStore';
import { SIDEBAR_SECTION } from '@/lib/sidebarSections';
import { useDeleteSession, useSaveSession } from '@/hooks/useSessions';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useConfirmedRestoreSession } from '@/hooks/useConfirmedRestoreSession';
import { useFocusAfterRowRemoval } from '@/hooks/useFocusAfterRowRemoval';
import { announceSectionView } from '@/lib/sectionViewStatus';
import { sessionDisplayColor } from '@/lib/sessionColor';
import {
  SIDEBAR_FOCUS_RING,
  SIDEBAR_ICON_BUTTON,
  SIDEBAR_ROW,
  SIDEBAR_ROW_ACTIVE,
  SidebarSection,
  sidebarRowDetailClass,
  sidebarRowNameClass
} from './SidebarSection';

/**
 * The "Sessions" sidebar section: the user's saved sessions (never automatic backups, which live in
 * Settings → Data). A row's name opens a read-only preview in the main panel (`mainView`
 * `session`); Restore (behind its confirmation) and Delete are sibling buttons. The header's
 * action saves the current groups as a new session.
 */
export function SessionsSection({ groups, sessions }: { groups: readonly Group[]; sessions: readonly Session[] }) {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.openSidebarSection === SIDEBAR_SECTION.sessions);
  const toggle = useUIStore((s) => s.toggleSidebarSection);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const viewedId = useUIStore((s) => (s.mainView?.kind === 'session' ? s.mainView.sessionId : null));
  const openMainView = useUIStore((s) => s.openMainView);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const openModal = useUIStore((s) => s.openModal);
  const { sessions: hasSessions, cloudSync } = useEntitlements();
  const { mutate: deleteSession } = useDeleteSession();
  const { mutateAsync: saveSession } = useSaveSession();
  const { restore, restoring, confirmDialog } = useConfirmedRestoreSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const focus = useFocusAfterRowRemoval(rootRef, sessions.map((s) => s.id), 'data-session-open');

  const remove = (session: Session) => {
    focus.prepare(session.id);
    deleteSession(session.id, {
      onSuccess: () => announceSectionView(t('sidePanel.view.deleted', { name: session.name })),
      onError: focus.cancel
    });
  };

  // Moved from Header (P4, popup-ui-consolidation-spec.md): "Save session" lives in the section header
  const handleSaveSession = () => {
    openModal('saveSession', {
      onSave: async (name: string, description?: string, picked?: string) => {
        // Random: never the colour of the most recent session, so two in a row differ
        const color = picked ?? pickAutoColor(sessions[0] ? sessionDisplayColor(sessions[0]) : undefined);
        try {
          await saveSession({ name, description, color, sessionCount: sessions.length, hasSessions, cloudSync });
          toast.success(t('sidePanel.toast.sessionSaved'));
        } catch (err) {
          if (err instanceof Error && err.message === 'SESSION_LIMIT') {
            toast.error(t('sidePanel.toast.sessionLimit', { max: FREE_TIER_LIMITS.sessions }), {
              action: { label: t('common.upgrade'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
            });
          } else {
            toast.error(t('sidePanel.toast.sessionFailed'));
          }
        }
      }
    });
  };

  const show = (sessionId: string) => {
    if (selectionMode) return;
    openMainView({ kind: 'session', sessionId }, groups[activeGroupIndex]?.id ?? null);
  };

  return (
    <div ref={rootRef}>
    <SidebarSection
      label={t('sidePanel.sessions')}
      count={sessions.length}
      open={open}
      onToggle={() => toggle(SIDEBAR_SECTION.sessions)}
      isEmpty={sessions.length === 0}
      emptyLabel={t('sidePanel.noSessions')}
      className="mt-1.5 mb-1.5"
      tourAnchor={TOUR_ANCHORS.sessions}
      action={
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-foreground')} onClick={handleSaveSession} aria-label={t('sidePanel.saveSession')}>
              <BookmarkPlus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('sidePanel.saveSession')}</TooltipContent>
        </Tooltip>
      }
    >
      <ul data-testid="sessions-list">
        {sessions.map((session) => {
          const active = session.id === viewedId;
          const { windows, tabs } = getSessionCounts(session);
          const detailId = `session-detail-${session.id}`;
          return (
            <li
              key={session.id}
              className={cn(SIDEBAR_ROW, 'gap-1.5 py-1.5', active && SIDEBAR_ROW_ACTIVE)}
              style={{ borderInlineStart: `3px solid ${sessionDisplayColor(session)}` }}
            >
              <button
                type="button"
                className={cn('flex-1 min-w-0 text-start', SIDEBAR_FOCUS_RING)}
                aria-label={t('sidePanel.view.showSession', { name: session.name })}
                aria-describedby={`${detailId} ${detailId}-counts`}
                aria-current={active ? 'page' : undefined}
                aria-disabled={selectionMode || undefined}
                data-session-open={session.id}
                onClick={() => show(session.id)}
              >
                <span dir="auto" className={cn('block truncate text-[11px] text-ui-start', sidebarRowNameClass(active))}>{session.name}</span>
                {session.description && (
                  <span dir="auto" className={cn('block truncate italic text-ui-start', sidebarRowDetailClass(active))} title={session.description}>
                    {session.description}
                  </span>
                )}
                <span id={detailId} className={cn('block', sidebarRowDetailClass(active))}>{formatTimeAgo(session.createdAt)}</span>
                <span id={`${detailId}-counts`} className="sr-only">
                  {t('sidePanel.view.sessionCounts', {
                    groups: t('common.groupCountTitle', { count: session.groups.length }),
                    windows: t('common.windowCountTitle', { count: windows }),
                    tabs: t('common.tabCountTitle', { count: tabs })
                  })}
                </span>
              </button>
              <span
                aria-hidden
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
                style={{ background: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-text-muted)' }}
              >
                <span>{session.groups.length}</span>
                <span className="opacity-40">◆</span>
                <span>{windows}</span>
                <span className="opacity-40">◆</span>
                <span>{tabs}</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-foreground disabled:opacity-50')}
                    disabled={restoring}
                    aria-label={t('sidePanel.restoreSessionNamed', { name: session.name })}
                    onClick={() => restore(session, () => announceSectionView(t('sidePanel.view.restored', { name: session.name })))}
                  >
                    <RotateCcw className="h-3 w-3 rtl:-scale-x-100" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('sidePanel.restoreSession')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-destructive')}
                    onClick={() => remove(session)}
                    aria-label={t('sidePanel.deleteSessionNamed', { name: session.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('sidePanel.deleteSession')}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
    {confirmDialog}
    </div>
  );
}
