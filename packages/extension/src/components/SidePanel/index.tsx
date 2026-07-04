import {
  DndContext,
  closestCenter,
  type DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GroupItem } from './GroupItem';
import type { GroupsState } from '@/lib/types';
import { useAddGroup } from '@/hooks/useGroups';
import { useDndSensors, useGroupDndHandlers } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useEntitlements } from '@/hooks/useEntitlements';

interface SidePanelProps {
  groupsState: GroupsState;
}

export function SidePanel({ groupsState }: SidePanelProps) {
  const sensors = useDndSensors();
  const { onDragEnd } = useGroupDndHandlers();
  const { mutate: addGroup } = useAddGroup();
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const openModal = useUIStore((s) => s.openModal);
  const { maxGroups } = useEntitlements();

  const { available } = groupsState;
  const groupIds = available.map((_, i) => `group-${i}`);

  const handleAddGroup = () => {
    if (available.length >= maxGroups) {
      openModal('upgrade', { reason: 'maxGroups' });
      return;
    }
    openModal('addGroup');
  };

  return (
    <div className="flex flex-col h-full border-r border-border" style={{ width: 210 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Groups
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          onClick={handleAddGroup}
          title="New group"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Groups list */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {available.map((group, i) => (
                <GroupItem
                  key={group.id}
                  group={group}
                  groupIndex={i}
                  isActive={i === activeGroupIndex}
                  onClick={() => setActiveGroupIndex(i)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </ScrollArea>
    </div>
  );
}
