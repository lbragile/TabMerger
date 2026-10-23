import React from 'react';
import { useTranslation } from 'react-i18next';
import { openableUrls } from '@/lib/safeOpen';
import { startMoveOnSpace, toggleSelectionOnCtrlSpace } from '@/lib/keyboardMoveEntry';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Trash2,
  Copy,
  Edit3,
  FileText,
  RefreshCw,
  GitMerge,
  Layers,
  SplitSquareHorizontal,
  SortAsc,
  ExternalLink,
  Archive,
  Sparkles
} from 'lucide-react';
import {
  useDeleteGroup,
  useDuplicateGroup,

  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  useDeleteAllWindows,
  useGroups,
  useArchiveGroup,
  useRestoreGroup,
  useUpdateGroupName
} from '@/hooks/useGroups';
import { useUIStore, type SelectedItem } from '@/stores/uiStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useNameGroup, QuotaExceededError } from '@/hooks/useAI';
import { isFixedInAiSettings } from '@/lib/aiErrors';
import { getSetting } from '@/lib/localDb';
import { findDuplicateTabs } from '@/lib/deduplication';
import { toast } from '@/lib/toast';
import type { Group } from '@/lib/types';
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { countedGroups } from '@/lib/tierLimits';

interface GroupContextMenuProps {
  group: Group;
  groupIndex: number;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAddNote?: () => void;
  wrapperRef?: (node: HTMLElement | null) => void;
  wrapperStyle?: React.CSSProperties;
  wrapperClassName?: string;
  /** Accessible name of the row; the group's name when omitted. */
  wrapperLabel?: string;
  /**
   * The row's positional DnD model id, rendered as `data-tm-dnd-id`. `dndMultiDrag` /
   * `dndDragVisuals` / `dndFocus` find rows through this STATIC attribute — without it a
   * multi-GROUP drag can't collapse the other selected sidebar rows or count them in the
   * ghost's `+N` badge.
   */
  wrapperDndId?: string;
  /** set for a draggable group row: plain Space on the focused row starts keyboard move mode for it */
  moveGroupId?: string;
  /** Selection item toggled by Ctrl+Space on the focused row; omit for a row that cannot be selected. */
  selectGroupItem?: SelectedItem;
  /** Roving-tabindex key handler for the row (see `useRovingRow`); runs before the row's own. */
  onWrapperKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onWrapperClick?: React.MouseEventHandler<HTMLDivElement>;
  onWrapperContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  onWrapperMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onWrapperMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}

export function GroupContextMenu({
  group,
  groupIndex,
  children,
  open,
  onOpenChange,
  wrapperRef,
  wrapperStyle,
  wrapperClassName,
  wrapperLabel,
  wrapperDndId,
  moveGroupId,
  selectGroupItem,
  onWrapperKeyDown,
  onWrapperClick,
  onWrapperContextMenu,
  onWrapperMouseEnter,
  onWrapperMouseLeave,
}: GroupContextMenuProps) {
  const { t } = useTranslation();
  const { mutate: _deleteGroup } = useDeleteGroup();
  const { mutate: archiveGroup } = useArchiveGroup();
  const { mutate: restoreGroup } = useRestoreGroup();
  const { maxGroups, maxTabs } = useEntitlements();
  const { mutate: duplicateGroup } = useDuplicateGroup({ maxGroups, maxTabs });
  const { data: groupsState } = useGroups();
  const { mutate: replaceWithCurrent } = useReplaceWithCurrent();
  const { mutate: mergeWithCurrent } = useMergeWithCurrent();
  const { mutate: uniteWindows } = useUniteWindows();
  const { mutate: splitWindows } = useSplitWindows();
  const { mutate: sortTabs } = useSortTabs();
  const { mutate: deleteAllWindows } = useDeleteAllWindows();
  const { mutate: updateGroupName } = useUpdateGroupName();
  const { aiFeatures } = useEntitlements();
  const { data: appSettings } = useAppSettings();
  const { mutateAsync: nameGroup } = useNameGroup();
  const openModal = useUIStore((s) => s.openModal);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const setPendingNoteGroupIndex = useUIStore((s) => s.setPendingNoteGroupIndex);

  // Same handler the windows-toolbar ⋯ uses (Windows/index.tsx `handleDeduplicate`) —
  // kept in sync per the P1 subset rule.
  const handleDeduplicate = () => {
    const duplicates = findDuplicateTabs(group.windows);
    if (duplicates.length === 0) {
      toast.info(t('groupMenu.toast.noDuplicates'));
      return;
    }
    openModal('deduplicateGroup', { groupIndex, duplicates });
  };

  // The inline group-note editor lives in Windows/index.tsx, not the sidebar. Select the
  // group so it's actually visible, then stash the target index for that panel to consume.
  const handleOpenNote = () => {
    setActiveGroupIndex(groupIndex);
    setPendingNoteGroupIndex(groupIndex);
  };

  const handleAIRename = async () => {
    const tabs = group.windows.flatMap((w) => w.tabs);
    if (tabs.length === 0) {
      toast.error(t('groupMenu.toast.noTabsToName'));
      return;
    }
    try {
      const { name } = await nameGroup(tabs);
      updateGroupName({ groupIndex, name });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        toast.error(t('common.aiQuotaUsed'), {
          action: { label: t('common.buyMore'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
        });
        return;
      }
      const message = err instanceof Error ? err.message : t('groupMenu.toast.aiRenameFailed');
      // The own key is missing or rejected, or the model is unavailable: fixed in Settings → AI
      if (isFixedInAiSettings(err)) {
        toast.error(message, { action: { label: t('common.openSettings'), onClick: () => openModal('settings', { tab: 'ai' }) } });
      } else {
        toast.error(message);
      }
    }
  };

  return (
    <div
      ref={wrapperRef as React.RefCallback<HTMLDivElement>}
      style={wrapperStyle}
      className={cn('relative focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', wrapperClassName)}
      tabIndex={0}
      role="button"
      aria-label={wrapperLabel ?? group.name}
      data-sidebar-group-index={groupIndex}
      data-tour={group.permanent ? TOUR_ANCHORS.nowOpen : undefined}
      data-tm-dnd-id={wrapperDndId}
      onClick={onWrapperClick}
      onKeyDown={(e) => {
        // Roving tabindex first: Left/Right/Home/End walk this row's controls. It is
        // inert mid-drag, so a keyboard drag's arrows still reach dnd-kit.
        onWrapperKeyDown?.(e);
        if (e.defaultPrevented) return;
        // Don't intercept keystrokes from nested inputs (e.g. rename field) — only
        // the row itself should activate on Enter/Space.
        if (e.target !== e.currentTarget) return;
        // Space picks a draggable group up (keyboard drag); Enter stays "activate". Rows with
        // no grip (Now Open) fall through to activation.
        if (selectGroupItem && toggleSelectionOnCtrlSpace(e, selectGroupItem)) return;
        if (moveGroupId && startMoveOnSpace(e, 'group', moveGroupId)) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onWrapperClick?.(e as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }}
      onContextMenu={onWrapperContextMenu}
      onMouseEnter={onWrapperMouseEnter}
      onMouseLeave={onWrapperMouseLeave}
    >
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          className="absolute inset-0 h-full w-full pointer-events-none opacity-0 focus:outline-none"
          tabIndex={-1}
          aria-hidden="true"
        />
        <DropdownMenuContent className="w-56 text-xs max-h-64 overflow-y-auto" align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
          {!group.permanent && (
            <DropdownMenuItem onClick={() => setRenameTarget({ kind: 'group', groupIndex })}>
              <Edit3 className="h-3.5 w-3.5 me-2 shrink-0" />
              <div><div>{t('groupMenu.rename')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.renameHint')}</div></div>
            </DropdownMenuItem>
          )}

          {!group.permanent && aiFeatures && appSettings?.aiNameGroupEnabled !== false && (
            <DropdownMenuItem onClick={handleAIRename}>
              <Sparkles className="h-3.5 w-3.5 me-2 shrink-0" />
              <div><div>{t('groupMenu.aiRename')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.aiRenameHint')}</div></div>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={handleOpenNote}>
            <FileText className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{group.note ? t('groupMenu.editNote') : t('groupMenu.addNote')}</div><div className="text-[10px] text-muted-foreground font-normal">{group.note ? t('groupMenu.editNoteHint') : t('groupMenu.addNoteHint')}</div></div>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => {
            if (countedGroups(groupsState?.available ?? []).length >= maxGroups) {
              trackEvent('entitlement_limit_hit', { limit: 'maxGroups' });
              toast.error(t('common.freeGroupLimit', { max: maxGroups }), {
                action: { label: t('common.upgrade'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
              });
              return;
            }
            duplicateGroup(groupIndex);
          }}>
            <Copy className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{t('groupMenu.duplicate')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.duplicateHint')}</div></div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* ponytail: these two blocks + their trailing separator are grouped so a
              permanent group (both blocks hidden) collapses to a single separator
              instead of rendering two adjacent ones. */}
          {!group.permanent && (
            <>
              <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
                <RefreshCw className="h-3.5 w-3.5 me-2 shrink-0" />
                <div><div>{t('groupMenu.replaceWithCurrent')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.replaceWithCurrentHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
                <GitMerge className="h-3.5 w-3.5 me-2 shrink-0" />
                <div><div>{t('groupMenu.mergeWithCurrent')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.mergeWithCurrentHint')}</div></div>
              </DropdownMenuItem>
              {(() => {
                const urls = openableUrls(group.windows.flatMap(w => w.tabs.map(tab => tab.url).filter(u => u?.startsWith('http'))));
                return (
                  <DropdownMenuItem
                    disabled={urls.length === 0}
                    onClick={() => { trackEvent('session_restored', { source: 'open_all' }); chrome.windows.create({ url: urls }); }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 me-2 shrink-0" />
                    <div><div>{t('groupMenu.openAll')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.openAllHint')}</div></div>
                  </DropdownMenuItem>
                );
              })()}
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
            <Layers className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{t('groupMenu.uniteWindows')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.uniteWindowsHint')}</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
            <SplitSquareHorizontal className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{t('groupMenu.splitWindows')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.splitWindowsHint')}</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
            <SortAsc className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{t('groupMenu.sortByTitle')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.sortByTitleHint')}</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
            <SortAsc className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{t('groupMenu.sortByUrl')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.sortByUrlHint')}</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeduplicate} data-tour={TOUR_ANCHORS.groupDeduplicate}>
            <Copy className="h-3.5 w-3.5 me-2 shrink-0" />
            <div><div>{t('groupMenu.deduplicate')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.deduplicateHint')}</div></div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Reversible "put away" action — its own group, deliberately kept apart
              from the destructive ones below. Mixing them (red, neutral, red) made
              Archive read as a third destructive option. */}
          {!group.permanent && (
            <>
              {group.archived ? (
                <DropdownMenuItem onClick={() => restoreGroup(groupIndex)}>
                  <Archive className="h-3.5 w-3.5 me-2 shrink-0" />
                  <div><div>{t('groupMenu.restore')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.restoreHint')}</div></div>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => archiveGroup(groupIndex)}>
                  <Archive className="h-3.5 w-3.5 me-2 shrink-0" />
                  <div><div>{t('groupMenu.archive')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.archiveHint')}</div></div>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          {/* Danger zone — every destructive action together, at the bottom, ordered
              least to most destructive so the final item is the one that removes the
              most. For "Now Open" only the first applies. */}
          <DropdownMenuItem
            className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
            onClick={async () => {
              const { confirmOnDelete } = await getSetting<{ confirmOnDelete: boolean }>(
                'appSettings',
                { confirmOnDelete: false }
              );
              if (confirmOnDelete) {
                openModal('removeAllWindows', {
                  isNowOpen: !!group.permanent,
                  onConfirm: () => deleteAllWindows({ groupIndex })
                });
              } else {
                deleteAllWindows({ groupIndex });
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 me-2 shrink-0" />
            <div>
              <div>{group.permanent ? t('groupMenu.closeAllWindows') : t('groupMenu.removeAllWindows')}</div>
              <div className="text-[10px] font-normal opacity-60">
                {group.permanent ? t('groupMenu.closeAllWindowsHint') : t('groupMenu.removeAllWindowsHint')}
              </div>
            </div>
          </DropdownMenuItem>
          {!group.permanent && (
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
              onClick={async () => {
                const { confirmOnDelete } = await getSetting<{ confirmOnDelete: boolean }>(
                  'appSettings',
                  { confirmOnDelete: false }
                );
                if (confirmOnDelete) {
                  openModal('deleteGroup', { groupIndex, groupName: group.name });
                } else {
                  _deleteGroup(groupIndex);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 me-2 shrink-0" />
              <div><div>{t('groupMenu.deleteGroup')}</div><div className="text-[10px] font-normal opacity-60">{t('groupMenu.deleteGroupHint')}</div></div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
    </div>
  );
}
