import { useEffect, useRef, useState } from 'react';
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
import { SIDEBAR_FOCUS_RING, SIDEBAR_ICON_BUTTON, SidebarSection } from './SidebarSection';

/**
 * The "Auto-saved" sidebar section (above Archived and Sessions): groups "Auto-save open tabs"
 * made, newest first. They are kept out of the main group list and the footer stats. A row opens
 * the group in the main panel; Keep makes it a normal group; Delete removes it. On Free the label
 * reads "n of 2" and the auto-save the next run replaces says so. After Keep or Delete the focus
 * moves to the next row (or the section toggle when none is left).
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
  // closed until the user opens it, like Archived and Sessions
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /** After Keep / Delete: the row that leaves, and where focus goes once it is gone. */
  const [focusAfter, setFocusAfter] = useState<{ goneId: string; nextId: string | null } | null>(null);

  const list = listAutoSavedGroups(groupsState.available);
  useAutoSavePromotionToast();
  useAutoSaveIntroToast(list.length > 0);

  useEffect(() => {
    if (!focusAfter || list.some(({ group }) => group.id === focusAfter.goneId)) return;
    setFocusAfter(null);
    const root = rootRef.current;
    const next = focusAfter.nextId ? root?.querySelector<HTMLElement>(`[data-auto-save-open="${CSS.escape(focusAfter.nextId)}"]`) : null;
    (next ?? root?.querySelector<HTMLElement>('[data-sidebar-section-toggle]'))?.focus();
  }, [list, focusAfter]);

  // Free: only rolling auto-saves are replaced, so the "n of 2" count is theirs when every listed one rolls
  const rollingCount = list.filter(({ group }) => isRollingAutoSave(group)).length;
  const count = free && rollingCount === list.length && list.length > 0 ? t('autoSave.sidebar.countOfMax', { count: rollingCount, max: AUTO_SAVE_FREE_KEEP_COUNT }) : list.length;
  const nextReplaced = new Set(free ? rollingToReplace(groupsState.available).map((g) => g.id) : []);

  const neighbourOf = (groupId: string): string | null => {
    const at = list.findIndex(({ group }) => group.id === groupId);
    return (list[at + 1] ?? list[at - 1])?.group.id ?? null;
  };

  const handleKeep = async (groupId: string) => {
    const before = useUIStore.getState().undoStack[0];
    setFocusAfter({ goneId: groupId, nextId: neighbourOf(groupId) });
    try {
      await keep(groupId);
      showAutoSaveKeptToast(qc, before);
    } catch {
      setFocusAfter(null);
      toast.error(t('autoSave.toast.keptFailed'));
    }
  };

  const handleDelete = (groupId: string, name: string, realIndex: number) => {
    setFocusAfter({ goneId: groupId, nextId: neighbourOf(groupId) });
    deleteGroup(realIndex, {
      // the row is gone: say so (focus moved on, so nothing else would)
      onSuccess: () => toast.success(t('autoSave.sidebar.deleted', { name }), { id: 'auto-save-deleted' }),
      onError: () => setFocusAfter(null)
    });
  };

  return (
    <div ref={rootRef}>
      <SidebarSection
        label={t('autoSave.sidebar.label')}
        count={count}
        open={open}
        onToggle={() => setOpen(!open)}
        isEmpty={list.length === 0}
        emptyLabel={t('autoSave.sidebar.empty')}
        className="mt-1.5"
        action={
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-foreground aria-disabled:opacity-50')}
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
        <ul data-testid="auto-saved-list">
          {list.map(({ group, realIndex }) => {
            const replacedNext = nextReplaced.has(group.id) && rollingCount >= AUTO_SAVE_FREE_KEEP_COUNT;
            const isActive = realIndex === activeGroupIndex;
            const tabs = getGroupTabCount(group);
            const detailId = `auto-save-detail-${group.id}`;
            return (
              <li
                key={group.id}
                className={cn('flex items-center gap-1 px-2 py-1 transition-colors min-w-0 hover:bg-[var(--sidebar-hover-bg)]', isActive && 'bg-[var(--sidebar-hover-bg)]')}
                style={{ borderInlineStart: `3px solid ${group.color}` }}
              >
                <button
                  type="button"
                  className={cn('flex-1 min-w-0 text-start', SIDEBAR_FOCUS_RING)}
                  aria-label={t('autoSave.sidebar.open', { name: group.name })}
                  aria-describedby={`${detailId} ${detailId}-counts`}
                  aria-current={isActive ? 'true' : undefined}
                  data-auto-save-open={group.id}
                  onClick={() => !selectionMode && setActiveGroupIndex(realIndex)}
                >
                  <span dir="auto" className="block truncate text-[11px] text-muted-foreground text-ui-start">{group.name}</span>
                  <span id={detailId} className={cn('block truncate text-[0.625rem]', replacedNext ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                    {replacedNext ? t('autoSave.sidebar.replacedNext') : formatTimeAgo(group.autoSave!.at)}
                  </span>
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
                      className={cn(SIDEBAR_ICON_BUTTON, 'hover:text-destructive')}
                      onClick={() => handleDelete(group.id, group.name, realIndex)}
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
    </div>
  );
}
