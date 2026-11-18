import { useId, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Bookmark, RotateCcw } from 'lucide-react';
import type { Group, Session } from '@/lib/types';
import { formatDateTime } from '@/lib/i18n';
import { getGroupTabCount, getSessionCounts } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useDeleteSession } from '@/hooks/useSessions';
import { useConfirmedRestoreSession } from '@/hooks/useConfirmedRestoreSession';
import { announceSectionView } from '@/lib/sectionViewStatus';
import { handleReadOnlyListKeyDown } from '@/lib/readOnlyListKeys';
import { sessionDisplayColor } from '@/lib/sessionColor';
import { SectionViewHeader } from './SectionViewHeader';
import { DOT_SEPARATOR, SeparatedText } from './SeparatedText';
import { ReadOnlyWindows } from './ReadOnlyWindows';
import { SessionColorMenu } from './SessionColorMenu';
import { FadedScrollArea } from './FadedScrollArea';

/** When a session was saved: "Nov 10, 6:22 PM", with the year when it isn't this year. */
function sessionDate(createdAt: number): string {
  const sameYear = new Date(createdAt).getFullYear() === new Date().getFullYear();
  return formatDateTime(createdAt, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The header's tile: a bookmark in the session's colour on a tint of it (theme values in globals.css). */
function SessionTile({ color }: { color: string }) {
  return (
    <span aria-hidden="true" data-session-tile="" className="tm-session-tile flex h-7 w-7 shrink-0 items-center justify-center" style={{ '--item-color': color } as CSSProperties}>
      <Bookmark className="h-3.5 w-3.5" strokeWidth={1.8} />
    </span>
  );
}

/**
 * One group of a session: a header that sticks to the top of the scroll area while its windows
 * pass under it (colour square, name as the h3 that names the group, its counts), then its
 * windows as brackets whose tiles stick just below that header.
 */
function SessionGroup({ group, headingId }: { group: Group; headingId: string }) {
  const { t } = useTranslation();
  const counts = t('sidePanel.view.groupCounts', {
    windows: t('common.windowCount', { count: group.windows.length }),
    tabs: t('common.tabCount', { count: getGroupTabCount(group) })
  });
  return (
    <div role="group" aria-labelledby={headingId} className="min-w-0 pb-1.5" data-session-group="">
      <div className="sticky top-0 z-[3] flex h-[var(--section-group-header)] min-w-0 items-center gap-2.5 border-b border-border/60 bg-background" data-session-group-header="">
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: group.color }} />
        <h3 id={headingId} dir="auto" className="min-w-0 truncate text-[0.8125rem] font-bold text-ui-start" title={group.name}>{group.name}</h3>
        <p className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground"><SeparatedText text={counts} separator={DOT_SEPARATOR} /></p>
      </div>
      <ReadOnlyWindows windows={group.windows} groupName={group.name} color={group.color} underGroupHeader ownArrowKeys={false} />
    </div>
  );
}

/**
 * A saved session, read-only, in the main panel (`mainView` `session`): a header (colour tile,
 * name, "Saved … · 5 groups · 7 windows · 20 tabs", the description), then each of its groups
 * with a sticky header and its windows as brackets, and an "End of session" line. Looking
 * changes nothing; "Restore session" asks first (it closes every browser window), as the sidebar
 * row does. Tabs open on click; Up/Down move across every group's tabs as one list.
 */
export function SessionView({ session, groups }: { session: Session; groups: readonly Group[] }) {
  const { t } = useTranslation();
  const closeMainView = useUIStore((s) => s.closeMainView);
  const { mutate: deleteSession } = useDeleteSession();
  const { restore, restoring, confirmDialog } = useConfirmedRestoreSession();
  const { windows, tabs } = getSessionCounts(session);
  const tabCount = t('common.tabCount', { count: tabs });
  const color = sessionDisplayColor(session);
  const baseId = useId();

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="session-view">
      <SectionViewHeader
        prominent
        icon={<SessionTile color={color} />}
        title={session.name}
        meta={t('sidePanel.view.sessionSavedMeta', {
          date: sessionDate(session.createdAt),
          groups: t('common.groupCount', { count: session.groups.length }),
          windows: t('common.windowCount', { count: windows }),
          tabs: tabCount
        })}
        description={session.description}
        primaryLabel={t('sidePanel.restoreSession')}
        primaryIcon={<RotateCcw aria-hidden="true" />}
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
      />
      {/* One arrow-key list across every group's tabs */}
      <FadedScrollArea className="pb-4 pe-3 ps-5" onKeyDown={handleReadOnlyListKeyDown} topFadeClassName="top-[var(--section-group-header)]">
        {session.groups.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">{t('sidePanel.view.sessionEmpty')}</p>}
        {session.groups.map((group, groupIndex) => (
          <SessionGroup key={group.id} group={group} headingId={`${baseId}-g${groupIndex}`} />
        ))}
        {session.groups.length > 0 && (
          <p className="ms-[3.375rem] mt-2.5 text-[11px] text-muted-foreground" data-session-end="">
            <SeparatedText text={t('sidePanel.view.sessionEnd', { tabs: tabCount })} separator={DOT_SEPARATOR} />
          </p>
        )}
      </FadedScrollArea>
      {confirmDialog}
    </div>
  );
}
