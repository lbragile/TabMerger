import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group, Session } from '@/lib/types';
import { formatDateTime } from '@/lib/i18n';
import { formatGroupCounts, getGroupTabCount, getSessionCounts } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useDeleteSession } from '@/hooks/useSessions';
import { useConfirmedRestoreSession } from '@/hooks/useConfirmedRestoreSession';
import { announceSectionView } from '@/lib/sectionViewStatus';
import { handleReadOnlyListKeyDown } from '@/lib/readOnlyListKeys';
import { SectionViewHeader } from './SectionViewHeader';
import { SeparatedText } from './SeparatedText';
import { ReadOnlyWindows } from './ReadOnlyWindows';
import { SessionColorMenu } from './SessionColorMenu';
import { sessionDisplayColor } from '@/lib/sessionColor';

/** When a session was saved: "Nov 10, 6:22 PM", with the year when it isn't this year. */
function sessionDate(createdAt: number): string {
  const sameYear = new Date(createdAt).getFullYear() === new Date().getFullYear();
  return formatDateTime(createdAt, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * A saved session, read-only, in the main panel (`mainView` `session`): each of its groups with a
 * bar in the group's colour, its counts and its windows' tabs. Looking changes nothing; "Restore
 * session" asks first (it closes every browser window), as the sidebar row does. Tabs open on click.
 */
export function SessionView({ session, groups }: { session: Session; groups: readonly Group[] }) {
  const { t } = useTranslation();
  const closeMainView = useUIStore((s) => s.closeMainView);
  const { mutate: deleteSession } = useDeleteSession();
  const { restore, restoring, confirmDialog } = useConfirmedRestoreSession();
  const { tabs } = getSessionCounts(session);
  const baseId = useId();

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="session-view">
      <SectionViewHeader
        color={sessionDisplayColor(session)}
        title={session.name}
        meta={t('sidePanel.view.sessionMeta', {
          date: sessionDate(session.createdAt),
          groups: t('common.groupCountTitle', { count: session.groups.length }),
          tabs: t('common.tabCountTitle', { count: tabs })
        })}
        description={session.description}
        primaryLabel={t('sidePanel.restoreSession')}
        onPrimary={() =>
          restore(session, () => {
            closeMainView(groups);
            announceSectionView(t('sidePanel.view.restored', { name: session.name }));
          })
        }
        primaryDisabled={restoring}
        menuItems={<SessionColorMenu session={session} />}
        deleteLabel={t('sidePanel.deleteSession')}
        onDelete={() => deleteSession(session.id, { onSuccess: () => announceSectionView(t('sidePanel.view.deleted', { name: session.name })) })}
        onClose={() => closeMainView(groups)}
        banner={t('sidePanel.view.sessionBanner')}
      />
      {/* One arrow-key list across every group's tabs */}
      <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-2" onKeyDown={handleReadOnlyListKeyDown}>
        {session.groups.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">{t('sidePanel.view.sessionEmpty')}</p>}
        {session.groups.map((group, groupIndex) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`${baseId}-g${groupIndex}`}
            className="mb-3 min-w-0 ps-2"
            style={{ borderInlineStart: `3px solid ${group.color}` }}
          >
            <h3 id={`${baseId}-g${groupIndex}`} dir="auto" className="truncate text-xs font-semibold text-ui-start" title={group.name}>{group.name}</h3>
            <p className="mb-1 text-[10px] text-muted-foreground"><SeparatedText text={formatGroupCounts(group.windows.length, getGroupTabCount(group))} /></p>
            <ReadOnlyWindows windows={group.windows} headingLevel={4} ownArrowKeys={false} />
          </div>
        ))}
      </div>
      {confirmDialog}
    </div>
  );
}
