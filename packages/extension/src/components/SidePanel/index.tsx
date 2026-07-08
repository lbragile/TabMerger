import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type Modifier
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupItem } from './GroupItem';
import type { GroupsState } from '@/lib/types';
import { useDndSensors, useGroupDndHandlers } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useAddGroup } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { pluralize } from '@/lib/utils';

interface SidePanelProps {
  groupsState: GroupsState;
}

export function SidePanel({ groupsState }: SidePanelProps) {
  const sensors = useDndSensors();
  const { onDragEnd } = useGroupDndHandlers();
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);
  const { maxGroups } = useEntitlements();
  const { mutateAsync: addGroup } = useAddGroup();

  const handleNewGroup = async () => {
    if (groupsState.available.length - 1 >= maxGroups) {
      toast.error(`Free plan allows up to ${maxGroups} groups.`, {
        action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
      });
      return;
    }
    // New group is appended at end of available[]; since it's unstarred it lands at the
    // bottom of the sorted display list — display index = current length before the add.
    const newIndex = groupsState.available.length;
    await addGroup({});
    setActiveGroupIndex(newIndex);
    setRenameTarget({ kind: 'group', groupIndex: newIndex });
  };

  // Render in zone order: Now Open (permanent) → starred → unstarred.
  // This mirrors what is stored in IndexedDB after any mutation, but is applied
  // defensively here so the UI is correct even if legacy data arrives unsorted.
  const rawAvailable = groupsState.available;
  const nowOpenGroup = rawAvailable[0];
  const rest = rawAvailable.slice(1);
  const available = [
    nowOpenGroup,
    ...rest.filter((g) => g.starred),
    ...rest.filter((g) => !g.starred)
  ];
  const groupIds = available.map((_, i) => `group-${i}`);

  // Restrict group reordering to vertical axis only
  const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

  return (
    <div
      className="flex flex-col h-full shrink-0 bg-zone-sidebar"
      style={{ width: 210, borderRight: '1px solid var(--zone-sidebar-border)' }}
    >
      {/* Groups list */}
      <ScrollArea className="flex-1">
        <div className="p-1.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={selectionMode ? () => {} : onDragEnd}
          >
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {available.map((group, i) => (
                <GroupItem
                  key={group.id}
                  group={group}
                  groupIndex={i}
                  isActive={i === activeGroupIndex}
                  onClick={() => !selectionMode && setActiveGroupIndex(i)}
                />
              ))}
            </SortableContext>
          </DndContext>

          <div className="flex justify-center">
          <Button
            variant="outline"
            className="h-8 rounded-md px-3 mt-2 text-xs"
            onClick={handleNewGroup}
            disabled={selectionMode}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Group
          </Button>
          </div>
        </div>
      </ScrollArea>

      {/* Footer — stats */}
      <div
        className="px-2 py-2 shrink-0"
        style={{ borderTop: '1px solid var(--zone-sidebar-border)' }}
      >
        {(() => {
          const saved = available.filter((g) => !g.permanent);
          const groupCount = saved.length;
          const winCount = saved.reduce((acc, g) => acc + g.windows.length, 0);
          const tabCount = saved.reduce((acc, g) => acc + g.windows.reduce((a, w) => a + w.tabs.length, 0), 0);
          return (
            <p className="text-[10px] text-center text-muted-foreground">
              {groupCount} {pluralize(groupCount, 'Group')} &middot;{' '}
              {winCount} {pluralize(winCount, 'Window')} &middot;{' '}
              {tabCount} {pluralize(tabCount, 'Tab')}
            </p>
          );
        })()}
        </div>
    </div>
  );
}
