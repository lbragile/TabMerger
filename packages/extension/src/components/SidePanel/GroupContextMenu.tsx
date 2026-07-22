import React from 'react';
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
  Link
} from 'lucide-react';
import {
  useDeleteGroup,
  useDuplicateGroup,

  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  useGroups,
  useArchiveGroup,
  useRestoreGroup
} from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import { toast } from 'sonner';
import type { Group } from '@/lib/types';
import { cn } from '@/lib/utils';

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
  onWrapperClick,
  onWrapperContextMenu,
  onWrapperMouseEnter,
  onWrapperMouseLeave,
}: GroupContextMenuProps) {
  const { mutate: _deleteGroup } = useDeleteGroup();
  const { mutate: archiveGroup } = useArchiveGroup();
  const { mutate: restoreGroup } = useRestoreGroup();
  const { mutate: duplicateGroup } = useDuplicateGroup();
  const { data: groupsState } = useGroups();
  const { maxGroups } = useEntitlements();
  const { mutate: replaceWithCurrent } = useReplaceWithCurrent();
  const { mutate: mergeWithCurrent } = useMergeWithCurrent();
  const { mutate: uniteWindows } = useUniteWindows();
  const { mutate: splitWindows } = useSplitWindows();
  const { mutate: sortTabs } = useSortTabs();
  const openModal = useUIStore((s) => s.openModal);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);

  return (
    <div
      ref={wrapperRef as React.RefCallback<HTMLDivElement>}
      style={wrapperStyle}
      className={cn('relative focus:outline-none focus-visible:ring-2 focus-visible:ring-primary', wrapperClassName)}
      tabIndex={0}
      role="button"
      aria-label={group.name}
      data-sidebar-group-index={groupIndex}
      onClick={onWrapperClick}
      onKeyDown={(e) => {
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

          <DropdownMenuItem onClick={() => openModal('note', { groupIndex, groupId: group.id })}>
            <FileText className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>{group.note ? 'Edit note' : 'Add note'}</div><div className="text-[10px] text-muted-foreground font-normal">{group.note ? 'Update the note for this group' : 'Attach a note to this group'}</div></div>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => openModal('urlRules')}>
            <Link className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Manage URL rules</div><div className="text-[10px] text-muted-foreground font-normal">Auto-assign tabs to groups by URL pattern</div></div>
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => {
            if ((groupsState?.available.length ?? 1) - 1 >= maxGroups) {
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
            </>
          )}

          {!group.permanent && (() => {
            const urls = group.windows.flatMap(w => w.tabs.map(t => t.url).filter(u => u?.startsWith('http')));
            return (
              <DropdownMenuItem
                disabled={urls.length === 0}
                onClick={() => chrome.windows.create({ url: urls })}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Open all in new window</div><div className="text-[10px] text-muted-foreground font-normal">Open every tab in this group in a new window</div></div>
              </DropdownMenuItem>
            );
          })()}

          <DropdownMenuSeparator />

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

          {!group.permanent && (
            <>
              <DropdownMenuSeparator />
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
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                onClick={() => openModal('deleteGroup', { groupIndex, groupName: group.name })}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Delete group</div><div className="text-[10px] font-normal opacity-60">Permanently remove this group and its tabs</div></div>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
    </div>
  );
}
