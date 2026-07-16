import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
  DragOverlay
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { Plus, MoreHorizontal, RefreshCw, GitMerge, Layers, SplitSquareHorizontal, SortAsc, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { WindowItem } from './Window';
import type { Group, GroupsState, Tab } from '@/lib/types';
import {
  useAddWindow,
  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  useDeleteAllWindows,
  GROUPS_QUERY_KEY
} from '@/hooks/useGroups';
import { useDndSensors, useWindowDndHandlers, parseDndId } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useQueryClient } from '@tanstack/react-query';
import { saveGroupsState } from '@/lib/localDb';
import { parseSearchQuery, cn, formatGroupCounts } from '@/lib/utils';
import { deduplicateTabs } from '@/lib/deduplication';
import { toast } from 'sonner';

interface WindowsPanelProps {
  group: Group;
  groupIndex: number;
}

const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// Positions the overlay's top-left at the cursor so it follows the pointer exactly
const snapTabToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!activatorEvent || !draggingNodeRect) return transform;
  const coords = getEventCoordinates(activatorEvent as MouseEvent | TouchEvent);
  if (!coords) return transform;
  return {
    ...transform,
    x: transform.x + (coords.x - draggingNodeRect.left),
    y: transform.y + (coords.y - draggingNodeRect.top),
  };
};



export function WindowsPanel({ group, groupIndex }: WindowsPanelProps) {
  const sensors = useDndSensors();
  const { onDragEnd: onWindowDragEnd } = useWindowDndHandlers(groupIndex);
  const { mutate: addWindow } = useAddWindow();
  const rawSearchFilter = useUIStore((s) => s.searchFilter);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const openModal = useUIStore((s) => s.openModal);
  const qc = useQueryClient();

  const handleDeduplicate = () => {
    const allTabs = group.windows.flatMap((w) => w.tabs);
    const { duplicates } = deduplicateTabs(allTabs);
    if (duplicates.length === 0) {
      toast.info('No duplicates found');
      return;
    }
    openModal('deduplicateGroup', { groupIndex, duplicates });
  };

  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [activeWindow, setActiveWindow] = useState<import('@/lib/types').Window | null>(null);
  const [isDraggingTab, setIsDraggingTab] = useState(false);
  const [activeWindowIndex, setActiveWindowIndex] = useState<number | null>(null);
  const [insertState, setInsertState] = useState<{ tabId: string; position: 'before' | 'after' } | null>(null);
  const dragStartWinRef = useRef<number | null>(null);

  const { mutate: replaceWithCurrent } = useReplaceWithCurrent();
  const { mutate: mergeWithCurrent } = useMergeWithCurrent();
  const { mutate: uniteWindows } = useUniteWindows();
  const { mutate: splitWindows } = useSplitWindows();
  const { mutate: sortTabs } = useSortTabs();
  const { mutate: deleteAllWindows } = useDeleteAllWindows();

  const { tabQuery: searchFilter, tagFilter } = parseSearchQuery(rawSearchFilter);

  const windowIds = group.windows.map((_, i) => `window-${groupIndex}-${i}`);
  const { setNodeRef: setEndDropRef, isOver: isOverEnd } = useDroppable({ id: `windows-end-${groupIndex}` });

  function findTabPos(windows: typeof group.windows, tabId: number) {
    for (let wi = 0; wi < windows.length; wi++) {
      const ti = windows[wi].tabs.findIndex((t) => t.id === tabId);
      if (ti !== -1) return { winIdx: wi, tabIdx: ti };
    }
    return null;
  }

  const handleDragStart = (e: DragStartEvent) => {
    const parsed = parseDndId(String(e.active.id));
    if (parsed.kind === 'tab') {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const grp = state?.available[groupIndex] ?? group;
      const pos = findTabPos(grp.windows, parsed.tabId);
      if (pos) {
        setActiveTab(grp.windows[pos.winIdx].tabs[pos.tabIdx]);
        setIsDraggingTab(true);
        setActiveWindowIndex(pos.winIdx);
        dragStartWinRef.current = pos.winIdx;
      }
    } else if (parsed.kind === 'window') {
      const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
      const grp = state?.available[groupIndex] ?? group;
      setActiveWindow(grp.windows[parsed.windowIndex] ?? null);
    }
  };

  // Fires on every pointer move — keeps insertion line smooth across the 50% threshold
  const handleDragMove = (e: DragMoveEvent) => {
    const { over } = e;
    if (!over || !activeTab) return;
    const to = parseDndId(String(over.id));
    if (to.kind === 'tab') {
      const pos = findTabPos(group.windows, to.tabId);
      if (pos) {
        setActiveWindowIndex(pos.winIdx);
        if (pos.winIdx !== dragStartWinRef.current) {
          // Cross-window: compute before/after using cursor Y (translated.top) vs tab center
          // snapTabToCursor pins ghost top-left to cursor, so translated.top ≈ cursor Y
          const translated = e.active.rect.current.translated;
          const overRect = e.over?.rect;
          const position: 'before' | 'after' =
            translated && overRect && translated.top > overRect.top + overRect.height / 2
              ? 'after'
              : 'before';
          setInsertState({ tabId: String(over.id), position });
        } else {
          setInsertState(null);
        }
      }
    } else if (to.kind === 'window') {
      setActiveWindowIndex(to.windowIndex);
      if (to.windowIndex !== dragStartWinRef.current) {
        const destWin = group.windows[to.windowIndex];
        const translated = e.active.rect.current.translated;
        const overRect = e.over?.rect;
        // If cursor is in the upper half of the window and there are tabs, insert before the first tab
        const firstTab = destWin?.tabs[0];
        if (firstTab && translated && overRect && translated.top < overRect.top + overRect.height / 2) {
          setInsertState({ tabId: `tab-${firstTab.id}-${to.windowIndex}-0`, position: 'before' });
        } else {
          setInsertState({ tabId: '__end__', position: 'after' });
        }
      } else {
        setInsertState(null);
      }
    }
  };

  const handleDragCancel = () => {
    setActiveTab(null);
    setActiveWindow(null);
    setIsDraggingTab(false);
    setActiveWindowIndex(null);
    setInsertState(null);
    dragStartWinRef.current = null;
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const draggedTab = activeTab;
    const startWinIdx = dragStartWinRef.current;
    setActiveTab(null);
    setActiveWindow(null);
    setIsDraggingTab(false);
    setActiveWindowIndex(null);
    setInsertState(null);
    dragStartWinRef.current = null;

    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const from = parseDndId(String(active.id));
    if (from.kind === 'window') {
      // Dropped onto the end-sentinel: move window to last position
      if (String(over.id) === `windows-end-${groupIndex}`) {
        const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
        if (!state) return;
        const available = [...state.available];
        const grp = { ...available[groupIndex] };
        const windows = [...grp.windows];
        const [moved] = windows.splice(from.windowIndex, 1);
        windows.push(moved);
        grp.windows = windows;
        grp.updatedAt = Date.now();
        grp.pendingSync = true;
        available[groupIndex] = grp;
        const next = { ...state, available };
        await saveGroupsState(next);
        qc.setQueryData(GROUPS_QUERY_KEY, next);
        return;
      }
      return onWindowDragEnd(e);
    }
    if (from.kind !== 'tab' || !draggedTab || startWinIdx === null) return;

    const to = parseDndId(String(over.id));
    if (to.kind !== 'tab' && to.kind !== 'window') return;

    // Resolve destination window + tab index
    const srcPos = findTabPos(group.windows, draggedTab.id);
    if (!srcPos) return;

    let destWinIdx: number;
    let destTabIdx: number;

    if (to.kind === 'window') {
      destWinIdx = to.windowIndex;
      destTabIdx = group.windows[destWinIdx]?.tabs.length ?? 0;
    } else {
      // Use position from 4-part DnD ID directly — avoids wrong match on duplicate tab.id
      destWinIdx = to.windowIndex;
      destTabIdx = to.tabIndex;
    }

    // Now Open: delegate to Chrome API
    if (group.permanent) {
      const destWin = group.windows[destWinIdx];
      if (destWin) await chrome.tabs.move(draggedTab.id, { windowId: destWin.id, index: destTabIdx });
      return;
    }

    // Saved group
    const state = qc.getQueryData<GroupsState>(GROUPS_QUERY_KEY);
    if (!state) return;

    const windows = group.windows.map(w => ({ ...w, tabs: [...w.tabs] }));
    if (srcPos.winIdx === destWinIdx) {
      // Same-window: arrayMove
      windows[srcPos.winIdx].tabs = arrayMove(windows[srcPos.winIdx].tabs, srcPos.tabIdx, destTabIdx);
    } else {
      // Cross-window: splice from src, insert at dest
      // 50% threshold: if dragged element's center is below target's center, insert after
      let insertIdx = destTabIdx;
      if (to.kind === 'tab') {
        const translated = e.active.rect.current.translated;
        const overRect = e.over?.rect;
        if (translated && overRect) {
          const activeCenter = translated.top + translated.height / 2;
          const overCenter = overRect.top + overRect.height / 2;
          if (activeCenter > overCenter) insertIdx++;
        }
      }
      const [moved] = windows[srcPos.winIdx].tabs.splice(srcPos.tabIdx, 1);
      windows[destWinIdx].tabs.splice(insertIdx, 0, moved);
    }

    const grp = { ...state.available[groupIndex], windows, updatedAt: Date.now(), pendingSync: true };
    const available = [...state.available];
    available[groupIndex] = grp;
    const next = { ...state, available };
    await saveGroupsState(next);
    qc.setQueryData(GROUPS_QUERY_KEY, next);
  };

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground flex items-center gap-1.5">
          <span>{formatGroupCounts(group.windows.length, group.windows.reduce((a, w) => a + w.tabs.length, 0))}</span>
          {group.note && (
            <>
              <span className="opacity-30">·</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="italic text-muted-foreground/70 truncate max-w-[120px] cursor-default">{group.note}</span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{group.note}</TooltipContent>
              </Tooltip>
            </>
          )}
        </span>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Replace with current tabs</div><div className="text-[10px] text-muted-foreground font-normal">Swap all windows with your open browser session</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
                <GitMerge className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Merge with current tabs</div><div className="text-[10px] text-muted-foreground font-normal">Add your open browser windows to this group</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
                <Layers className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Unite all windows</div><div className="text-[10px] text-muted-foreground font-normal">Combine all windows into one</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
                <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Split into windows</div><div className="text-[10px] text-muted-foreground font-normal">Move each tab into its own window</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Sort tabs by title</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort all tabs by name</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Sort tabs by URL</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort all tabs by address</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDeduplicate}>
                <Copy className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Deduplicate tabs</div><div className="text-[10px] text-muted-foreground font-normal">Remove tabs with duplicate URLs</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                onClick={() => deleteAllWindows({ groupIndex })}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div>
                  <div>{group.permanent ? 'Close all windows' : 'Remove all windows'}</div>
                  <div className="text-[10px] font-normal opacity-60">
                    {group.permanent ? 'Close all browser windows in this group' : 'Permanently remove all windows and their tabs'}
                  </div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragCancel={handleDragCancel}
            onDragEnd={(e) => void handleDragEnd(e)}
          >
            <SortableContext items={windowIds} strategy={verticalListSortingStrategy}>
              {group.windows.map((window, windowIndex) => (
                <WindowItem
                  key={window.id}
                  window={window}
                  groupIndex={groupIndex}
                  windowIndex={windowIndex}
                  siblingCount={group.windows.length}
                  tabIds={window.tabs.filter(Boolean).map((t, ti) => `tab-${t.id}-${windowIndex}-${ti}`)}
                  isDraggingTab={isDraggingTab}
                  activeWindowIndex={activeWindowIndex}
                  dragStartWinIndex={dragStartWinRef.current}
                  insertState={insertState}
                  groupColor={group.color}
                  isBeingDragged={activeWindow != null && window.id === activeWindow.id}
                  searchFilter={searchFilter}
                  tagFilter={tagFilter}
                />
              ))}
            </SortableContext>

            {/* Sentinel drop zone — lets windows be placed after the last item */}
            <div ref={setEndDropRef} className={cn('h-4 rounded transition-colors', isOverEnd && 'bg-primary/10')} />

            {createPortal(
              <DragOverlay dropAnimation={null} modifiers={activeTab ? [snapTabToCursor] : [restrictToVerticalAxis]}>
                {activeTab ? (
                  <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm bg-accent shadow-md border border-border opacity-90 pointer-events-none">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-700 overflow-hidden flex items-center justify-center">
                      {activeTab.favIconUrl && (
                        <img src={activeTab.favIconUrl} alt="" className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="truncate max-w-[200px] text-xs">{activeTab.title}</span>
                  </div>
                ) : activeWindow ? (
                  <div className="rounded-md border border-border bg-card shadow-lg opacity-90 pointer-events-none px-2 py-1.5 text-xs font-medium">
                    {activeWindow.name ?? 'Window'} · {activeWindow.tabs.length} tab{activeWindow.tabs.length !== 1 ? 's' : ''}
                  </div>
                ) : null}
              </DragOverlay>,
              document.body
            )}
          </DndContext>

          {group.windows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No windows in this group</p>
          )}

          {!group.permanent && (
            <div className="flex justify-center mt-1">
              <Button
                variant="outline"
                className="h-8 rounded-md px-3 mt-2 text-xs"
                onClick={() => addWindow({ groupIndex })}
                disabled={selectionMode}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Window
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
