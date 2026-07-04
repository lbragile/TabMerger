import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, MoreHorizontal, RefreshCw, GitMerge, Layers, SplitSquareHorizontal, SortAsc } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { WindowItem } from './Window';
import type { Group, Tab } from '@/lib/types';
import {
  useAddWindow,
  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  GROUPS_QUERY_KEY
} from '@/hooks/useGroups';
import { useDndSensors, useWindowDndHandlers, parseDndId } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useQueryClient } from '@tanstack/react-query';
import { getGroupsState, saveGroupsState } from '@/lib/localDb';

interface WindowsPanelProps {
  group: Group;
  groupIndex: number;
}

export function WindowsPanel({ group, groupIndex }: WindowsPanelProps) {
  const sensors = useDndSensors();
  const { onDragEnd: onWindowDragEnd } = useWindowDndHandlers(groupIndex);
  const { mutate: addWindow } = useAddWindow();
  const searchFilter = useUIStore((s) => s.searchFilter);
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  const { mutate: replaceWithCurrent } = useReplaceWithCurrent();
  const { mutate: mergeWithCurrent } = useMergeWithCurrent();
  const { mutate: uniteWindows } = useUniteWindows();
  const { mutate: splitWindows } = useSplitWindows();
  const { mutate: sortTabs } = useSortTabs();

  // IDs for window-level sorting
  const windowIds = group.windows.map((_, i) => `window-${groupIndex}-${i}`);

  // IDs for all tabs (for cross-window DnD)
  const allTabIds = group.windows.flatMap((w, wi) =>
    w.tabs.map((_, ti) => `tab-${groupIndex}-${wi}-${ti}`)
  );

  const handleDragStart = (e: DragStartEvent) => {
    const parsed = parseDndId(String(e.active.id));
    if (parsed.kind === 'tab') {
      const tab = group.windows[parsed.windowIndex]?.tabs[parsed.tabIndex];
      if (tab) setActiveTab(tab);
    }
  };

  const handleDragOver = async (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;

    const from = parseDndId(String(active.id));
    const to = parseDndId(String(over.id));

    if (from.kind !== 'tab') return;
    // Same window — handled by dragEnd
    if (from.windowIndex === to.windowIndex) return;

    const state = await getGroupsState();
    const available = [...state.available];
    const grp = { ...available[groupIndex] };
    const windows = grp.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));

    const movedTab = windows[from.windowIndex].tabs[from.tabIndex];
    if (!movedTab) return;

    windows[from.windowIndex].tabs.splice(from.tabIndex, 1);

    const destWinIdx = to.kind === 'tab' ? to.windowIndex : from.windowIndex;
    const destTabIdx = to.kind === 'tab' ? to.tabIndex : windows[destWinIdx].tabs.length;
    windows[destWinIdx].tabs.splice(destTabIdx, 0, movedTab);

    grp.windows = windows;
    grp.updatedAt = Date.now();
    grp.pendingSync = true;
    available[groupIndex] = grp;

    const next = { ...state, available };
    await saveGroupsState(next);
    qc.setQueryData(GROUPS_QUERY_KEY, next);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveTab(null);
    const { active, over } = e;
    if (!over) return;

    const from = parseDndId(String(active.id));
    const to = parseDndId(String(over.id));

    // Window reorder
    if (from.kind === 'window') {
      return onWindowDragEnd(e);
    }

    // Tab reorder within same window
    if (from.kind === 'tab' && from.windowIndex === to.windowIndex && active.id !== over.id) {
      const state = await getGroupsState();
      const available = [...state.available];
      const grp = { ...available[groupIndex] };
      const windows = grp.windows.map((w) => ({ ...w, tabs: [...w.tabs] }));

      const [movedTab] = windows[from.windowIndex].tabs.splice(from.tabIndex, 1);
      windows[to.windowIndex].tabs.splice(to.tabIndex, 0, movedTab);

      grp.windows = windows;
      grp.updatedAt = Date.now();
      grp.pendingSync = true;
      available[groupIndex] = grp;

      const next = { ...state, available };
      await saveGroupsState(next);
      qc.setQueryData(GROUPS_QUERY_KEY, next);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground">
          {group.info ?? `${group.windows.length} ${group.windows.length === 1 ? 'window' : 'windows'}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => addWindow({ groupIndex })}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Window
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Replace with current tabs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
                <GitMerge className="h-3.5 w-3.5 mr-2" />
                Merge with current tabs
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
                <Layers className="h-3.5 w-3.5 mr-2" />
                Unite all windows
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
                <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2" />
                Split into windows
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2" />
                Sort tabs by title
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2" />
                Sort tabs by URL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Windows list with single DndContext for all tabs + windows */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={(e) => void handleDragOver(e)}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <SortableContext items={[...windowIds, ...allTabIds]} strategy={verticalListSortingStrategy}>
              {group.windows.map((window, windowIndex) => (
                <WindowItem
                  key={`${window.id}-${windowIndex}`}
                  window={window}
                  groupIndex={groupIndex}
                  windowIndex={windowIndex}
                  searchFilter={searchFilter}
                />
              ))}
            </SortableContext>

            <DragOverlay dropAnimation={null}>
              {activeTab && (
                <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs bg-accent shadow-md border border-border">
                  {activeTab.favIconUrl && (
                    <img src={activeTab.favIconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" />
                  )}
                  <span className="truncate max-w-[160px]">{activeTab.title}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {group.windows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <p className="text-sm text-muted-foreground">No windows in this group</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 text-xs"
                onClick={() => addWindow({ groupIndex })}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add window
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
