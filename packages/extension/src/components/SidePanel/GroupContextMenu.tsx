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
  useSortTabs
} from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
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
        <DropdownMenuContent className="w-48 text-xs max-h-64 overflow-y-auto" align="start">
          <DropdownMenuItem onClick={() => setRenameTarget({ kind: 'group', groupIndex })}>
            <Edit3 className="h-3.5 w-3.5 mr-2" />
            Rename
          </DropdownMenuItem>

          <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
            <PopoverTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Palette className="h-3.5 w-3.5 mr-2" />
                Change color
              </DropdownMenuItem>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" side="right">
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
            onClick={() =>
              openModal('importExport', { mode: 'note', groupIndex, groupId: group.id })
            }
          >
            <FileText className="h-3.5 w-3.5 mr-2" />
            Add/edit note
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => duplicateGroup(groupIndex)}>
            <Copy className="h-3.5 w-3.5 mr-2" />
            Duplicate
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Replace with current
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
            <GitMerge className="h-3.5 w-3.5 mr-2" />
            Merge with current
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
            <Layers className="h-3.5 w-3.5 mr-2" />
            Unite windows
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
            <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2" />
            Split windows
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
            <SortAsc className="h-3.5 w-3.5 mr-2" />
            Sort by title
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
            <SortAsc className="h-3.5 w-3.5 mr-2" />
            Sort by URL
          </DropdownMenuItem>

          {!group.permanent && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() =>
                  openModal('deleteGroup', { groupIndex, groupName: group.name })
                }
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete group
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
    </div>
  );
}
