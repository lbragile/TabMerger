import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GroupContextMenu } from './GroupContextMenu';
import { ColorPicker } from '@/components/ColorPicker';
import type { Group } from '@/lib/types';
import { useUpdateGroupName, useUpdateGroupColor } from '@/hooks/useGroups';
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
  const { mutate: updateGroupName } = useUpdateGroupName();
  const { mutate: updateGroupColor } = useUpdateGroupColor();

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

  return (
    <GroupContextMenu
      group={group}
      groupIndex={groupIndex}
      open={contextMenuOpen}
      onOpenChange={setContextMenuOpen}
      wrapperRef={setNodeRef}
      wrapperStyle={style}
      wrapperClassName={cn(
        'group flex items-center gap-1.5 px-1.5 py-1.5 rounded-md cursor-pointer select-none transition-colors',
        isActive && 'bg-accent',
        !isActive && 'hover:bg-accent/50',
        isDragging && 'opacity-50',
        isOver && 'ring-2 ring-primary ring-inset',
        contextMenuOpen && 'bg-accent'
      )}
      onWrapperClick={onClick}
      onWrapperContextMenu={(e) => {
        e.preventDefault();
        setContextMenuOpen(true);
      }}
    >
        {/* Drag handle — only this element is draggable */}
        <span
          className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground touch-none shrink-0"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        {/* Color swatch — opens color picker on click */}
        <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-4 w-4 shrink-0 rounded-full ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 hover:ring-2 hover:ring-border hover:ring-offset-1 transition-all"
              style={{ backgroundColor: group.color }}
              title="Change color"
              onClick={(e) => e.stopPropagation()}
            />
          </PopoverTrigger>
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

        {/* Name */}
        {isRenaming ? (
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
            className="flex-1 text-xs bg-transparent border-b border-primary outline-none min-w-0"
          />
        ) : (
          <span className="flex-1 truncate text-xs font-medium">{group.name}</span>
        )}

        {/* Tab count badge */}
        <Badge variant="secondary" className="h-4 min-w-[1.25rem] px-1 text-[10px] shrink-0">
          {tabCount}
        </Badge>
    </GroupContextMenu>
  );
}
