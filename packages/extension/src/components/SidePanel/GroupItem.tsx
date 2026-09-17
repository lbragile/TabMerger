import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { GripVertical, Square, CheckSquare, Star, Lock, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupContextMenu } from './GroupContextMenu';
import { ColorPicker } from '@/components/ColorPicker';
import type { Group } from '@/lib/types';
import { useUpdateGroupName, useUpdateGroupColor, useToggleGroupStar, useGroups, useDeleteGroup } from '@/hooks/useGroups';
import { useDndContext } from '@/components/dnd/DndProvider';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { getGroupTabCount } from '@/lib/utils';
import { DEFAULT_GROUP_TITLE } from '@/lib/types';
import { gapTransformFor } from '@/lib/dndInsertion';
import { DND_POINTER_PROBE_ACTIVE } from '@/lib/dndPointerProbe';

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
  // MODEL id — the group's real `group.id` (not positional "group-N"). Same id for
  // sortable + droppable so a dragged window/tab can land on the row (cross-group move).
  const { attributes, listeners, setNodeRef: setSortableRef, transform, transition, isDragging } =
    useSortable({ id: group.id, data: { type: 'group', groupId: group.id, index: groupIndex } });

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: group.id,
    data: { type: 'group', groupId: group.id, index: groupIndex }
  });

  // A non-anchor row that is part of an active multi-drag selection dims to 0.4.
  const { isDragging: dndDragging, active: dndActive, gap } = useDndContext();
  const keyboardDrag = dndActive?.keyboard === true;
  const isDimmedBySelection =
    dndDragging &&
    !!dndActive?.selectionIds &&
    dndActive.selectionIds.includes(group.id) &&
    dndActive.id !== group.id;

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
  const { mutate: deleteGroup } = useDeleteGroup();

  const [editValue, setEditValue] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // ponytail: only show the name tooltip when the text is actually clipped
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isNameTruncated, setIsNameTruncated] = useState(false);
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const measure = () => setIsNameTruncated(el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [group.name]);

  const isRenaming = renameTarget?.kind === 'group' && renameTarget.groupIndex === groupIndex;

  useEffect(() => {
    if (!isRenaming) return;
    setEditValue(group.name);
    // Delay past Radix's dropdown close animation which restores focus to the trigger
    const id = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 50);
    return () => clearTimeout(id);
  }, [isRenaming, group.name]);

  // ponytail: a freshly-created group is only "real" once the user commits a
  // non-placeholder name. Explicit cancel (X button / Escape) before that
  // deletes the phantom "temp group" entry. Blur/Enter must NOT delete —
  // that fires on any click-away (e.g. going to add tabs), so it just
  // commits/reverts like a normal rename, same as an existing group.
  const isAbandonedFreshGroup = () =>
    !group.permanent &&
    group.name === DEFAULT_GROUP_TITLE &&
    (!editValue.trim() || editValue.trim() === DEFAULT_GROUP_TITLE);

  const handleRename = () => {
    if (group.permanent) { setRenameTarget(null); return; }
    if (editValue.trim()) {
      updateGroupName({ groupIndex, name: editValue.trim() });
    }
    setRenameTarget(null);
  };

  const handleCancelRename = () => {
    if (isAbandonedFreshGroup()) {
      deleteGroup(groupIndex);
    }
    setRenameTarget(null);
  };

  const tabCount = getGroupTabCount(group);
  // `Html5DragSensor` runs a native HTML5 drag; in the MV3 popup Chrome aborts it
  // the moment the dragged group row (an ancestor of its grip) mutates. So: no
  // live `transform`, a STABLE `transition` (dnd-kit's flips mid-drag), and no
  // `isDragging` class toggle (see className). Ghost card is the affordance.
  // Insertion-gap transform while a native drag has collapsed its source row.
  const gapTransform = gapTransformFor(gap, group.id);
  // Keyboard drags (no native session) DO render the live transform — see Tab.tsx.
  const style = {
    transform: isDragging && !keyboardDrag ? undefined : gapTransform !== null ? gapTransform : CSS.Transform.toString(transform),
    transition: 'transform 200ms ease'
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
        opacity: isDimmedBySelection ? 0.4 : undefined,
        background:
          isSelected
            ? 'rgba(0, 180, 204, 0.15)'
            : isActive || contextMenuOpen
            ? 'rgba(255,255,255,0.12)'
            : undefined,
        borderLeft: isActive ? `3px solid ${group.color}` : '3px solid transparent',
        // --sidebar-text-active: ≈14.5:1 (light) / 14:1 (dark) against the selected tint.
        // The old full-opacity rgba(0,180,204) outline was only ≈2.0:1 in the light theme.
        outline: isSelected ? '2px solid var(--sidebar-text-active)' : undefined,
        outlineOffset: '-2px',
      }}
      wrapperClassName={cn(
        'group flex items-center gap-2 px-2.5 py-2 select-none transition-colors',
        isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        // No `isDragging` class toggle, and suppress the `isOver` ring when THIS
        // row is the drag source — mutating the dragged row's className mid-drag
        // aborts the native HTML5 drag in the MV3 popup. Ghost is the affordance.
        isOver && dndActive?.id !== group.id && 'ring-1 ring-white/30 ring-inset',
        // KEYBOARD drags only (C4 doesn't apply): lift the dragged row.
        isDragging && keyboardDrag && 'relative z-10 shadow-lg ring-2 ring-ring',
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
        {/* Single slot: checkbox in selection mode, drag handle otherwise */}
        {showCheckbox ? (
          <button
            type="button"
            className="shrink-0 flex items-center justify-center h-4 w-4 text-(--sidebar-text-inactive) hover:text-(--sidebar-text-active) transition-colors"
            onClick={handleCheckboxClick}
            role="checkbox"
            aria-checked={isSelected}
            aria-label={`Select ${group.name}`}
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
              className="cursor-grab active:cursor-grabbing touch-none shrink-0 opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-opacity"
              style={{ color: 'var(--sidebar-text-subtle)' }}
              // Native onDragStart activator (see useDnd.ts + dndHtml5Sensor) needs
              // `draggable` set — dnd-kit only spreads `listeners`, never the attr.
              draggable={!selectionMode && !DND_POINTER_PROBE_ACTIVE}
              {...(selectionMode ? {} : { ...attributes, ...listeners })}
              // `aria-pressed` is left to dnd-kit: attribute-only changes survive a native
              // drag even synchronously in `dragstart` (popupAbortWindow `gripAriaPressed`, C4).
              // Keep the "Drag to reorder" PREFIX: the DnD sensor/visuals select the grip by it.
              aria-label={selectionMode ? undefined : `Drag to reorder group: ${group.name}`}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-3 w-3" />
            </span>
          ) : (
            <span className="h-3 w-3 shrink-0" />
          )
        )}

        {/* Color swatch — opens color picker on click; hidden while renaming */}
        {!isRenaming && (
          <Tooltip>
            <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-2.5 w-2.5 shrink-0 rounded-full transition-all hover:scale-125 motion-reduce:transition-none motion-reduce:hover:scale-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
        )}

        {/* Name slot */}
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                size={1}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') handleCancelRename(); }}
                onBlur={handleRename}
                className="min-w-0 flex-1 bg-transparent outline-none text-xs"
                style={{ borderBottom: '1px solid rgba(0,180,204,0.6)', color: 'var(--sidebar-text-active)' }}
              />
              <button type="button" aria-label="Save" className="shrink-0 flex items-center justify-center h-4 w-4 rounded-sm bg-primary/20 hover:bg-primary/40 text-primary" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); handleRename(); }}><Check className="h-2.5 w-2.5" /></button>
              <button type="button" aria-label="Cancel" className="shrink-0 flex items-center justify-center h-4 w-4 rounded-sm bg-muted/60 hover:bg-muted text-muted-foreground" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); handleCancelRename(); }}><X className="h-2.5 w-2.5" /></button>
            </div>
          ) : (
            <Tooltip open={isNameTruncated ? undefined : false}>
              <TooltipTrigger asChild>
                <span
                  ref={nameRef}
                  className="block truncate text-xs font-medium"
                  style={{ color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text-inactive)' }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (group.permanent) return;
                    setRenameTarget({ kind: 'group', groupIndex });
                  }}
                >
                  {group.name}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{group.name}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Windows ◆ tabs badge — hidden while renaming */}
        {!isRenaming && <span
          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
          style={{
            background: 'var(--sidebar-badge-bg)',
            color: 'var(--sidebar-text-muted)',
          }}
        >
          <span>{group.windows.length}</span>
          <span className="opacity-40">◆</span>
          <span>{tabCount}</span>
        </span>}

        {/* Star/pin button — hidden while renaming, in selection mode, or when locked */}
        {!isRenaming && (isLocked ? (
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
                  'shrink-0 transition-opacity focus-visible:ring-2 focus-visible:ring-ring',
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
        ))}

    </GroupContextMenu>
  );
}
