import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { GripVertical, Square, CheckSquare, Star } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupContextMenu } from './GroupContextMenu';
import { ColorPicker } from '@/components/ColorPicker';
import type { Group } from '@/lib/types';
import { useUpdateGroupName, useUpdateGroupColor, useToggleGroupStar } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { getGroupTabCount } from '@/lib/utils';

interface GroupItemProps {
  group: Group;
  groupIndex: number;
  isActive: boolean;
  onClick: () => void;
}

export function GroupItem({ group, groupIndex, isActive, onClick }: GroupItemProps) {
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } =
    useSortable({ id: `group-${groupIndex}` });

  // Also make it droppable for window combine
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `group-${groupIndex}`,
    data: { type: 'group', groupIndex }
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setSortableRef(node);
    setDroppableRef(node);
  };

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const renameTarget = useUIStore((s) => s.renameTarget);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const toggleSelection = useUIStore((s) => s.toggleSelection);
  const enterSelectionMode = useUIStore((s) => s.enterSelectionMode);
  const { mutate: updateGroupName } = useUpdateGroupName();
  const { mutate: updateGroupColor } = useUpdateGroupColor();
  const { mutate: toggleGroupStar } = useToggleGroupStar();

  const [editValue, setEditValue] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = renameTarget?.kind === 'group' && renameTarget.groupIndex === groupIndex;

  useEffect(() => {
    if (isRenaming) {
      setEditValue(group.name);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isRenaming, group.name]);

  const handleRename = () => {
    if (group.permanent) { setRenameTarget(null); return; }
    if (editValue.trim()) {
      updateGroupName({ groupIndex, name: editValue.trim() });
    }
    setRenameTarget(null);
  };

  const tabCount = getGroupTabCount(group);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  // Derive selection state for this group
  const committedType = selectedItems[0]?.type ?? null;
  const showCheckbox = selectionMode && (!committedType || committedType === 'group');
  const selectionId = `group-${groupIndex}`;
  const isSelected = selectedItems.some((s) => s.id === selectionId);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSelection({ type: 'group', id: selectionId });
  };

  const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Ctrl+click anywhere on the group row enters selection mode and toggles this group
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      enterSelectionMode();
      toggleSelection({ type: 'group', id: selectionId });
      return;
    }
    onClick();
  };

  return (
    <GroupContextMenu
      group={group}
      groupIndex={groupIndex}
      open={contextMenuOpen}
      onOpenChange={setContextMenuOpen}
      wrapperRef={setNodeRef}
      wrapperStyle={{
        ...style,
        background:
          isSelected
            ? 'rgba(0, 180, 204, 0.15)'
            : isActive || contextMenuOpen
            ? 'rgba(255,255,255,0.12)'
            : undefined,
        borderRadius: 8,
        outline: isSelected ? '2px solid rgba(0, 180, 204, 0.5)' : undefined,
        outlineOffset: '-2px'
      }}
      wrapperClassName={cn(
        'group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer select-none transition-colors',
        isDragging && 'opacity-50',
        isOver && 'ring-1 ring-white/30 ring-inset',
      )}
      onWrapperClick={handleWrapperClick}
      onWrapperContextMenu={(e) => {
        e.preventDefault();
        setContextMenuOpen(true);
      }}
      // Hover highlight is handled via inline style (not Tailwind) because the
      // sidebar has a fixed dark background that CSS variables can't target.
      onWrapperMouseEnter={(e) => {
        if (!isActive && !contextMenuOpen && !isSelected) {
          e.currentTarget.style.background = 'rgba(255,255,255,0.07)';
        }
      }}
      onWrapperMouseLeave={(e) => {
        if (!isActive && !contextMenuOpen && !isSelected) {
          e.currentTarget.style.background = '';
        }
      }}
    >
        {/* Drag handle — hover-only; hidden entirely for permanent (Now Open) group which cannot be reordered */}
        {!group.permanent && (
          <span
            className="cursor-grab touch-none shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--sidebar-text-subtle)' }}
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3" />
          </span>
        )}

        {/* Selection checkbox — only visible when in selection mode and type is committed to 'group' (or uncommitted) */}
        {showCheckbox && (
          <button
            type="button"
            className="shrink-0 flex items-center justify-center h-4 w-4 text-[var(--sidebar-text-inactive)] hover:text-[var(--sidebar-text-active)] transition-colors"
            onClick={handleCheckboxClick}
            aria-label={isSelected ? 'Deselect group' : 'Select group'}
          >
            {isSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-accent-foreground" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {/* Color swatch — opens color picker on click */}
        <Tooltip>
          <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-2.5 w-2.5 shrink-0 rounded-full transition-all hover:scale-125"
                  style={{ backgroundColor: group.color }}
                  onClick={(e) => e.stopPropagation()}
                />
              </PopoverTrigger>
            </TooltipTrigger>
            <PopoverContent
              className="w-auto p-0"
              side="bottom"
              align="start"
              sideOffset={4}
              onClick={(e) => e.stopPropagation()}
            >
              <ColorPicker
                value={group.color}
                onChange={(color) => {
                  updateGroupColor({ groupIndex, color });
                  setColorPickerOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <TooltipContent side="right">Change color</TooltipContent>
        </Tooltip>

        {/* Name */}
        {isRenaming ? (
          <input
            ref={inputRef}
            value={editValue}
            size={Math.max(editValue.length, 4)}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') setRenameTarget(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="py-0 text-xs bg-transparent outline-none"
            style={{ borderBottom: '1px solid rgba(0,180,204,0.6)', color: 'var(--sidebar-text-active)' }}
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-xs font-medium"
            style={{ color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text-inactive)' }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (group.permanent) return;
              setRenameTarget({ kind: 'group', groupIndex });
            }}
          >
            {group.name}
          </span>
        )}

        {/* Tab count badge */}
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
          style={{
            background: 'rgba(255,255,255,0.1)',
            color: 'var(--sidebar-text-muted)',
          }}
        >
          {tabCount}
        </span>

        {/* Star/pin button — always visible when starred, hover-visible otherwise */}
        {!group.permanent && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'shrink-0 transition-opacity',
                  group.starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGroupStar(groupIndex);
                }}
              >
                <Star
                  className="h-3 w-3 transition-colors"
                  style={{
                    fill: group.starred ? 'var(--star-active)' : 'none',
                    color: group.starred ? 'var(--star-active)' : 'var(--sidebar-text-subtle)'
                  }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{group.starred ? 'Unpin group' : 'Pin group'}</TooltipContent>
          </Tooltip>
        )}

    </GroupContextMenu>
  );
}
