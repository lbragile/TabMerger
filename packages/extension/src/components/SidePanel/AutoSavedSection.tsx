import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { History, Pin, Trash2 } from 'lucide-react';
import { AUTO_SAVE_FREE_KEEP_COUNT } from '@tabmerger/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GroupsState } from '@/lib/types';
import { formatTimeAgo } from '@/lib/i18n';
import { cn, getGroupTabCount } from '@/lib/utils';
import { isRollingAutoSave, listAutoSavedGroups, rollingToReplace } from '@/lib/autoSaveGroups';
import { useUIStore } from '@/stores/uiStore';
import { useDeleteGroup, useKeepAutoSave } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAutoSaveNow } from '@/hooks/useAutoSave';
import { showAutoSaveKeptToast, useAutoSaveIntroToast, useAutoSavePromotionToast } from '@/hooks/useAutoSaveToasts';
import { toast } from '@/lib/toast';
import { SidebarSection } from './SidebarSection';

/**
 * The "Auto-saved" sidebar section (above Archived and Sessions): groups "Auto-save open tabs"
 * made, newest first. They are kept out of the main group list and the footer stats. A row opens
 * the group in the main panel; Keep makes it a normal group; Delete removes it. On Free the label
 * reads "n of 2" and the auto-save the next run replaces says so.
 */
export function AutoSavedSection({ groupsState }: { groupsState: GroupsState }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tier } = useEntitlements();
  const free = tier === 'free';
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const { mutate: deleteGroup } = useDeleteGroup();
  const { mutateAsync: keep } = useKeepAutoSave();
  const { run, running } = useAutoSaveNow();
  // `null` until the user toggles it: open whenever there is something to show
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);

  const list = listAutoSavedGroups(groupsState.available);
  const open = openChoice ?? list.length > 0;
  useAutoSavePromotionToast();
  useAutoSaveIntroToast(list.length > 0);

  // Free: only rolling auto-saves are replaced, so the "n of 2" count is theirs when every listed one rolls
  const rollingCount = list.filter(({ group }) => isRollingAutoSave(group)).length;
  const count = free && rollingCount === list.length && list.length > 0 ? t('autoSave.sidebar.countOfMax', { count: rollingCount, max: AUTO_SAVE_FREE_KEEP_COUNT }) : list.length;
  const nextReplaced = new Set(free ? rollingToReplace(groupsState.available).map((g) => g.id) : []);

  const handleKeep = async (groupId: string) => {
    const before = useUIStore.getState().undoStack[0];
    try {
      await keep(groupId);
      showAutoSaveKeptToast(qc, before);
    } catch {
      toast.error(t('autoSave.toast.keptFailed'));
    }
  };

  return (
    <SidebarSection
      label={t('autoSave.sidebar.label')}
      count={count}
      open={open}
      onToggle={() => setOpenChoice(!open)}
      isEmpty={list.length === 0}
      emptyLabel={t('autoSave.sidebar.empty')}
      className="mt-1.5"
      action={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 aria-disabled:opacity-50"
              // aria-disabled, not disabled: focus stays on the button while the run is going
              aria-disabled={running}
              aria-busy={running}
              onClick={() => void run()}
              aria-label={t('autoSave.settings.runNow')}
              data-testid="auto-save-now"
            >
              <History className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('autoSave.settings.runNow')}</TooltipContent>
        </Tooltip>
      }
    >
      <ul aria-label={t('autoSave.sidebar.label')} data-testid="auto-saved-list">
        {list.map(({ group, realIndex }) => {
          const replacedNext = nextReplaced.has(group.id) && rollingCount >= AUTO_SAVE_FREE_KEEP_COUNT;
          const isActive = realIndex === activeGroupIndex;
          return (
            <li
              key={group.id}
              className={cn('flex items-center gap-1.5 px-2 py-1.5 transition-colors min-w-0 hover:bg-[var(--sidebar-hover-bg)]', isActive && 'bg-[var(--sidebar-hover-bg)]')}
              style={{ borderInlineStart: `3px solid ${group.color}` }}
            >
              <button
                type="button"
                className="flex-1 min-w-0 text-start"
                aria-label={t('autoSave.sidebar.open', { name: group.name })}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => !selectionMode && setActiveGroupIndex(realIndex)}
              >
                <span dir="auto" className="block truncate text-[11px] text-muted-foreground text-ui-start">{group.name}</span>
                <span className="block truncate text-[9px] text-muted-foreground/50">
                  {replacedNext ? t('autoSave.sidebar.replacedNext') : formatTimeAgo(group.autoSave!.at)}
                </span>
              </button>
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
                style={{ background: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-text-muted)' }}
              >
                <span>{group.windows.length}</span>
                <span className="opacity-40">◆</span>
                <span>{getGroupTabCount(group)}</span>
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => void handleKeep(group.id)}
                    aria-label={t('autoSave.sidebar.keepNamed', { name: group.name })}
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('autoSave.sidebar.keep')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => deleteGroup(realIndex)}
                    aria-label={t('autoSave.sidebar.deleteNamed', { name: group.name })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('autoSave.sidebar.delete')}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </SidebarSection>
  );
}
