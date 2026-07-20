import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { GripVertical, Square, CheckSquare, Star, Lock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupContextMenu } from './GroupContextMenu';
import { ColorPicker } from '@/components/ColorPicker';
import type { Group } from '@/lib/types';
import { useUpdateGroupName, useUpdateGroupColor, useToggleGroupStar, useGroups } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { getGroupTabCount } from '@/lib/utils';

interface GroupItemProps {
  group: Group;
  groupIndex: number;
  isActive: boolean;
  isLocked?: boolean;
  onClick: () => void;
}

export function GroupItem({ group, groupIndex, isActive, isLocked = false, onClick }: GroupItemProps) {
  const { data: groupsState } = useGroups();
  const savedGroupCount = (groupsState?.available ?? []).filter((g) => !g.permanent).length;
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
    if (!isRenaming) return;
    setEditValue(group.name);
    // Delay past Radix's dropdown close animation which restores focus to the trigger
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);
    return () => clearTimeout(id);
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
  const showCheckbox = selectionMode && !group.permanent && (!committedType || committedType === 'group');
  const selectionId = `group-${groupIndex}`;
  const isSelected = selectedItems.some((s) => s.id === selectionId);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSelection({ type: 'group', id: selectionId });
  };

  const handleWrapperClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isLocked) return;
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
        outlineOffset: '-2px',
      }}
      wrapperClassName={cn(
        'group flex items-center gap-2 px-2.5 py-2 rounded-lg select-none transition-colors',
        isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
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
          e.currentTarget.style.background = 'var(--sidebar-hover-bg)';
        }
      }}
      onWrapperMouseLeave={(e) => {
        if (!isActive && !contextMenuOpen && !isSelected) {
          e.currentTarget.style.background = '';
        }
      }}
    >
        {/* Active group: vertical accent bar on left + darker overlay */}
        {isActive && (
          <>
            <span
              className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
              style={{ background: group.color, filter: 'var(--sidebar-accent-filter)', pointerEvents: 'none' }}
              aria-hidden="true"
            />
            <span
              className="absolute inset-0 rounded-lg dark:hidden"
              style={{ background: 'rgba(0,0,0,0.06)', pointerEvents: 'none' }}
              aria-hidden="true"
            />
          </>
        )}
        {/* Single slot: checkbox in selection mode, drag handle otherwise */}
        {showCheckbox ? (
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
        ) : group.permanent ? (
          <span className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          savedGroupCount > 1 ? (
            <span
              className="cursor-grab touch-none shrink-0 opacity-30 group-hover:opacity-100 transition-opacity"
              style={{ color: 'var(--sidebar-text-subtle)' }}
              {...(selectionMode ? {} : { ...attributes, ...listeners })}
              aria-label={selectionMode ? undefined : 'Drag to reorder group'}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-3 w-3" />
            </span>
          ) : (
            <span className="h-3 w-3 shrink-0" />
          )
        )}

        {/* Color swatch — opens color picker on click */}
        <Tooltip>
          <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-2.5 w-2.5 shrink-0 rounded-full transition-all hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  style={{ backgroundColor: group.color }}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Change group color"
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
          <TooltipContent side="top">Change color</TooltipContent>
        </Tooltip>

        {/* Name — outer div holds the flex slot; span anchors height; input overlays when renaming */}
        <div className="flex-1 min-w-0 relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn('block truncate text-xs font-medium', isRenaming && 'invisible')}
                style={{ color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text-inactive)' }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (group.permanent) return;
                  setRenameTarget({ kind: 'group', groupIndex });
                }}
              >
                {group.name.length > 10 ? `${group.name.slice(0, 10)}…` : group.name}
              </span>
            </TooltipTrigger>
            {group.name.length > 10 && (
              <TooltipContent side="top">{group.name}</TooltipContent>
            )}
          </Tooltip>
          {isRenaming && (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setRenameTarget(null);
              }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-0 w-full bg-transparent outline-none text-xs px-0"
              style={{ borderBottom: '1px solid rgba(0,180,204,0.6)', color: 'var(--sidebar-text-active)' }}
            />
          )}
        </div>

        {/* Windows ◆ tabs badge */}
        <span
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md shrink-0 whitespace-nowrap"
          style={{
            background: 'var(--sidebar-badge-bg)',
            color: 'var(--sidebar-text-muted)',
          }}
        >
          <span>{group.windows.length}</span>
          <span className="opacity-40">◆</span>
          <span>{tabCount}</span>
        </span>

        {/* Star/pin button — hidden in selection mode or when locked; spacer preserves layout */}
        {isLocked ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-muted-foreground/60" aria-label="Pro required">
                <Lock className="h-3 w-3" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">Upgrade to Pro to access this group</TooltipContent>
          </Tooltip>
        ) : (group.permanent || selectionMode) ? (
          <span className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'shrink-0 transition-opacity focus-visible:ring-2 focus-visible:ring-ring rounded',
                  group.starred ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'
                )}
                aria-label={group.starred ? 'Unpin group' : 'Pin group'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGroupStar(groupIndex);
                }}
              >
                <Star
                  className="h-3 w-3 transition-colors"
                  style={{
                    fill: group.starred ? (group.color ?? 'var(--star-active)') : 'none',
                    color: group.starred ? (group.color ?? 'var(--star-active)') : 'var(--sidebar-text-subtle)'
                  }}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{group.starred ? 'Unpin group' : 'Pin group'}</TooltipContent>
          </Tooltip>
        )}

    </GroupContextMenu>
  );
}
