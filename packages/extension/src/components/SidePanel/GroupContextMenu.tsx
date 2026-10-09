import React from 'react';
import { startMoveOnSpace, toggleSelectionOnCtrlSpace } from '@/lib/keyboardMoveEntry';
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
import { getSetting } from '@/lib/localDb';
import { findDuplicateTabs } from '@/lib/deduplication';
import { toast } from '@/lib/toast';
import type { Group } from '@/lib/types';
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';

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
  wrapperDndId,
  moveGroupId,
  selectGroupItem,
  onWrapperKeyDown,
  onWrapperClick,
  onWrapperContextMenu,
  onWrapperMouseEnter,
  onWrapperMouseLeave,
}: GroupContextMenuProps) {
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
      toast.info('No duplicates found');
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
      toast.error('No tabs in this group to name');
      return;
    }
    try {
      const { name } = await nameGroup(tabs);
      updateGroupName({ groupIndex, name });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        toast.error("You've used all your AI credits for this month.", {
          action: { label: 'Buy more', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
        });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'AI rename failed');
    }
  };

  return (
    <div
      ref={wrapperRef as React.RefCallback<HTMLDivElement>}
      style={wrapperStyle}
      className={cn('relative focus:outline-none focus-visible:ring-2 focus-visible:ring-ring', wrapperClassName)}
      tabIndex={0}
      role="button"
      aria-label={group.name}
      data-sidebar-group-index={groupIndex}
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
              <Edit3 className="h-3.5 w-3.5 mr-2 shrink-0" />
              <div><div>Rename</div><div className="text-[10px] text-muted-foreground font-normal">Set a new name for this group</div></div>
            </DropdownMenuItem>
          )}

          {!group.permanent && aiFeatures && appSettings?.aiNameGroupEnabled !== false && (
            <DropdownMenuItem onClick={handleAIRename}>
              <Sparkles className="h-3.5 w-3.5 mr-2 shrink-0" />
              <div><div>AI rename</div><div className="text-[10px] text-muted-foreground font-normal">Suggest a name for this group with AI</div></div>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem onClick={handleOpenNote}>
            <FileText className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>{group.note ? 'Edit note' : 'Add note'}</div><div className="text-[10px] text-muted-foreground font-normal">{group.note ? 'Update the note for this group' : 'Attach a note to this group'}</div></div>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => {
            if ((groupsState?.available.length ?? 1) - 1 >= maxGroups) {
              trackEvent('entitlement_limit_hit', { limit: 'maxGroups' });
              toast.error(`Free plan allows up to ${maxGroups} groups.`, {
                action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
              });
              return;
            }
            duplicateGroup(groupIndex);
          }}>
            <Copy className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Duplicate</div><div className="text-[10px] text-muted-foreground font-normal">Copy this group with all its tabs</div></div>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* ponytail: these two blocks + their trailing separator are grouped so a
              permanent group (both blocks hidden) collapses to a single separator
              instead of rendering two adjacent ones. */}
          {!group.permanent && (
            <>
              <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Replace with current</div><div className="text-[10px] text-muted-foreground font-normal">Swap all windows with your open browser session</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
                <GitMerge className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Merge with current</div><div className="text-[10px] text-muted-foreground font-normal">Add your open browser windows to this group</div></div>
              </DropdownMenuItem>
              {(() => {
                const urls = group.windows.flatMap(w => w.tabs.map(t => t.url).filter(u => u?.startsWith('http')));
                return (
                  <DropdownMenuItem
                    disabled={urls.length === 0}
                    onClick={() => { trackEvent('session_restored', { source: 'open_all' }); chrome.windows.create({ url: urls }); }}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-2 shrink-0" />
                    <div><div>Open all in new window</div><div className="text-[10px] text-muted-foreground font-normal">Open every tab in this group in a new window</div></div>
                  </DropdownMenuItem>
                );
              })()}
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
            <Layers className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Unite windows</div><div className="text-[10px] text-muted-foreground font-normal">Combine all windows into one</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
            <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Split windows</div><div className="text-[10px] text-muted-foreground font-normal">Move each tab into its own window</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
            <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Sort by title</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort all tabs by name</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
            <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Sort by URL</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort all tabs by address</div></div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDeduplicate}>
            <Copy className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Deduplicate tabs</div><div className="text-[10px] text-muted-foreground font-normal">Remove tabs with duplicate URLs</div></div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {/* Reversible "put away" action — its own group, deliberately kept apart
              from the destructive ones below. Mixing them (red, neutral, red) made
              Archive read as a third destructive option. */}
          {!group.permanent && (
            <>
              {group.archived ? (
                <DropdownMenuItem onClick={() => restoreGroup(groupIndex)}>
                  <Archive className="h-3.5 w-3.5 mr-2 shrink-0" />
                  <div><div>Restore group</div><div className="text-[10px] text-muted-foreground font-normal">Move back to active groups</div></div>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => archiveGroup(groupIndex)}>
                  <Archive className="h-3.5 w-3.5 mr-2 shrink-0" />
                  <div><div>Archive group</div><div className="text-[10px] text-muted-foreground font-normal">Hide this group; restore it anytime</div></div>
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
            <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div>
              <div>{group.permanent ? 'Close all windows' : 'Remove all windows'}</div>
              <div className="text-[10px] font-normal opacity-60">
                {group.permanent ? 'Close all browser windows in this group' : 'Permanently remove all windows and their tabs'}
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
              <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
              <div><div>Delete group</div><div className="text-[10px] font-normal opacity-60">Permanently remove this group and its tabs</div></div>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
    </div>
  );
}
