import { useTranslation } from 'react-i18next';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Group } from '@/lib/types';
import { formatTimeAgo } from '@/lib/i18n';
import { cn, getGroupTabCount } from '@/lib/utils';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import { useUIStore } from '@/stores/uiStore';
import { SIDEBAR_SECTION } from '@/lib/sidebarSections';
import { useDeleteGroup, useRestoreGroup } from '@/hooks/useGroups';
import {
  SIDEBAR_FOCUS_RING,
  SIDEBAR_ICON_BUTTON,
  SIDEBAR_ROW,
  SIDEBAR_ROW_ACTIVE,
  SidebarSection,
  sidebarRowNameClass
} from './SidebarSection';

/**
 * The "Archived" sidebar section. A row's name opens the group read-only in the main panel
 * (`mainView` `archived`), the row the panel shows is marked current; Restore and Delete are
 * sibling buttons, never inside the open button. Rows don't open while selecting.
 */
export function ArchivedSection({ groups }: { groups: readonly Group[] }) {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.openSidebarSection === SIDEBAR_SECTION.archived);
  const toggle = useUIStore((s) => s.toggleSidebarSection);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const viewedId = useUIStore((s) => (s.mainView?.kind === 'archived' ? s.mainView.groupId : null));
  const openMainView = useUIStore((s) => s.openMainView);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const { mutate: restoreGroup } = useRestoreGroup();
  const { mutate: deleteGroup } = useDeleteGroup();

  const archived = groups.map((group, realIndex) => ({ group, realIndex })).filter(({ group }) => !group.permanent && group.archived);

  const show = (groupId: string) => {
    if (selectionMode) return;
    openMainView({ kind: 'archived', groupId }, groups[activeGroupIndex]?.id ?? null);
  };

  return (
    <SidebarSection
      label={t('sidePanel.archived')}
      count={archived.length}
      open={open}
      onToggle={() => toggle(SIDEBAR_SECTION.archived)}
      isEmpty={archived.length === 0}
      emptyLabel={t('sidePanel.noArchived')}
      className="mt-1.5"
      tourAnchor={TOUR_ANCHORS.archived}
    >
      <ul data-testid="archived-list">
        {archived.map(({ group, realIndex }) => {
          const active = group.id === viewedId;
          const tabs = getGroupTabCount(group);
          const detailId = `archived-detail-${group.id}`;
          return (
            <li key={group.id} className={cn(SIDEBAR_ROW, active && SIDEBAR_ROW_ACTIVE)} style={{ borderInlineStart: `3px solid ${group.color}` }}>
              <button
                type="button"
                className={cn('flex-1 min-w-0 text-start', SIDEBAR_FOCUS_RING)}
                aria-label={t('sidePanel.view.showArchived', { name: group.name })}
                aria-describedby={`${detailId} ${detailId}-counts`}
                aria-current={active ? 'page' : undefined}
                data-archived-open={group.id}
                onClick={() => show(group.id)}
              >
                <span dir="auto" className={cn('block truncate text-[11px] text-ui-start', sidebarRowNameClass(active))}>{group.name}</span>
                <span id={detailId} className="block truncate text-[0.625rem] text-muted-foreground">{formatTimeAgo(group.updatedAt)}</span>
                <span id={`${detailId}-counts`} className="sr-only">
                  {t('autoSave.sidebar.counts', { windows: t('common.windowCount', { count: group.windows.length }), tabs: t('common.tabCount', { count: tabs }) })}
                </span>
              </button>
              <span
                aria-hidden
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
                style={{ background: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-text-muted)' }}
              >
                <span>{group.windows.length}</span>
                <span className="opacity-40">◆</span>
                <span>{tabs}</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-foreground')}
                    onClick={() => restoreGroup(realIndex)}
                    aria-label={t('sidePanel.restoreNamed', { name: group.name })}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('sidePanel.restoreGroup')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-destructive')}
                    onClick={() => deleteGroup(realIndex)}
                    aria-label={t('sidePanel.deleteNamed', { name: group.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('sidePanel.deleteGroup')}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}
