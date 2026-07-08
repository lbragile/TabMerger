import React, { useState } from 'react';
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
  Palette,
  FileText,
  RefreshCw,
  GitMerge,
  Layers,
  SplitSquareHorizontal,
  SortAsc
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPicker } from '@/components/ColorPicker';
import {
  useDeleteGroup,
  useDuplicateGroup,
  useUpdateGroupColor,
  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  useGroups
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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const { mutate: deleteGroup } = useDeleteGroup();
  const { mutate: duplicateGroup } = useDuplicateGroup();
  const { data: groupsState } = useGroups();
  const { maxGroups } = useEntitlements();
  const { mutate: updateColor } = useUpdateGroupColor();
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
      className={cn('relative', wrapperClassName)}
      onClick={onWrapperClick}
      onContextMenu={onWrapperContextMenu}
      onMouseEnter={onWrapperMouseEnter}
      onMouseLeave={onWrapperMouseLeave}
    >
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {/*
          The trigger is a zero-size, pointer-events-none overlay so that left-clicking the
          group item (which is rendered as a sibling below) does NOT cause Radix's
          DropdownMenuTrigger to call onOpenChange — the menu opens only via right-click
          (controlled externally through the `open` prop).
        */}
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

          <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
            <PopoverTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Palette className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Change color</div><div className="text-[10px] text-muted-foreground font-normal">Pick a color for this group label</div></div>
              </DropdownMenuItem>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" side="top">
              <ColorPicker
                value={group.color}
                onChange={(color) => {
                  updateColor({ groupIndex, color });
                  setColorPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>

          <DropdownMenuItem
            onClick={() => openModal('note', { groupIndex, groupId: group.id })}
          >
            <FileText className="h-3.5 w-3.5 mr-2 shrink-0" />
            <div><div>Add/edit note</div><div className="text-[10px] text-muted-foreground font-normal">Attach a note to this group</div></div>
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
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                onClick={() =>
                  openModal('deleteGroup', { groupIndex, groupName: group.name })
                }
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
