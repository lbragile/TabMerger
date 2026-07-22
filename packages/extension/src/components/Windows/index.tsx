import React, { useState, useRef, useEffect } from 'react';
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
import { Plus, MoreHorizontal, RefreshCw, GitMerge, Layers, SplitSquareHorizontal, SortAsc, Trash2, Copy, StickyNote, Clock } from 'lucide-react';
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
  useUpdateGroupNote,
  useRemoveStaleTabs,
  GROUPS_QUERY_KEY
} from '@/hooks/useGroups';
import { useDndSensors, useWindowDndHandlers, parseDndId } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useQueryClient } from '@tanstack/react-query';
import { saveGroupsState, getSetting } from '@/lib/localDb';
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
  const scrollToWindowIndex = useUIStore((s) => s.scrollToWindowIndex);
  const setScrollToWindowIndex = useUIStore((s) => s.setScrollToWindowIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollToWindowIndex === null || activeGroupIndex !== groupIndex) return;
    const el = scrollContainerRef.current?.querySelector<HTMLElement>(`[data-window-index="${scrollToWindowIndex}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setScrollToWindowIndex(null);
  }, [scrollToWindowIndex, activeGroupIndex, groupIndex, setScrollToWindowIndex]);
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

  const { maxTabs } = useEntitlements();
  const { mutate: replaceWithCurrent } = useReplaceWithCurrent();
  const { mutate: mergeWithCurrent } = useMergeWithCurrent();
  const { mutate: uniteWindows } = useUniteWindows();
  const { mutate: splitWindows } = useSplitWindows();
  const { mutate: sortTabs } = useSortTabs();
  const { mutate: deleteAllWindows } = useDeleteAllWindows();
  const { mutate: updateGroupNote } = useUpdateGroupNote();

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteValue, setNoteValue] = useState('');
  const noteContainerRef = useRef<HTMLDivElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [staleThresholdMs, setStaleThresholdMs] = useState(30 * 24 * 60 * 60 * 1000);
  useEffect(() => {
    getSetting<{ staleThresholdDays?: number }>('appSettings', {}).then((s) => {
      const days = s.staleThresholdDays ?? 30;
      setStaleThresholdMs(days * 24 * 60 * 60 * 1000);
    });
  }, []);

  const { mutate: removeStaleTabs } = useRemoveStaleTabs();

  const staleCount = group.permanent ? 0 : group.windows.reduce(
    (acc, w) => acc + w.tabs.filter((t) => t.savedAt && Date.now() - t.savedAt > staleThresholdMs).length,
    0
  );

  const handleRemoveStaleTabs = () => removeStaleTabs({ groupIndex, staleThresholdMs });

  useEffect(() => {
    if (noteOpen) {
      setNoteValue(group.note ?? '');
      setTimeout(() => noteTextareaRef.current?.focus(), 0);
    }
  }, [noteOpen, group.note]);

  const commitGroupNote = () => {
    updateGroupNote({ groupIndex, note: noteValue.trim() });
    setNoteOpen(false);
  };

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
        </span>
        <div className="flex items-center gap-1">
          {staleCount > 0 && !group.permanent && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
                  onClick={handleRemoveStaleTabs}
                  aria-label={`Remove ${staleCount} stale tab${staleCount !== 1 ? 's' : ''}`}
                >
                  <Clock className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Remove {staleCount} stale tab{staleCount !== 1 ? 's' : ''}</TooltipContent>
            </Tooltip>
          )}
          {group.note && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="h-5 w-5 shrink-0 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring rounded"
                  onClick={() => setNoteOpen((o) => !o)}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Edit group note"
                >
                  <StickyNote className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Edit note</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="More group options">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              <DropdownMenuItem onClick={() => setNoteOpen((o) => !o)}>
                <StickyNote className="h-3.5 w-3.5 mr-2 shrink-0" />
                {group.note ? 'Edit note' : 'Add note'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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

      {noteOpen && (
        <div
          ref={noteContainerRef}
          className="mx-3 my-2 flex flex-col gap-1 border border-primary/40 bg-card p-2 shadow-xs shrink-0"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={noteTextareaRef}
            rows={2}
            maxLength={500}
            className="w-full border border-border bg-muted/50 px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Add a note for this group…"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNoteOpen(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitGroupNote();
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{noteValue.length}/500</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => setNoteOpen(false)}>Cancel</Button>
              <Button size="sm" className="h-5 text-[10px] px-2" onClick={commitGroupNote}>Save</Button>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollContainerRef} className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
        <div className="p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragCancel={handleDragCancel}
            onDragEnd={(e: import('@dnd-kit/core').DragEndEvent) => void handleDragEnd(e)}
          >
            <SortableContext items={windowIds} strategy={verticalListSortingStrategy}>
              {group.windows.reduce<{ els: React.ReactNode[]; offset: number }>(
                ({ els, offset }, window, windowIndex) => ({
                  els: [
                    ...els,
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
                      tabOffset={offset}
                      maxTabs={maxTabs}
                      staleThresholdMs={staleThresholdMs}
                    />
                  ],
                  offset: offset + window.tabs.length,
                }),
                { els: [], offset: 0 }
              ).els}
            </SortableContext>

            {/* Sentinel drop zone — lets windows be placed after the last item */}
            <div ref={setEndDropRef} className={cn('h-4 transition-colors', isOverEnd && 'bg-primary/10')} />

            {createPortal(
              <DragOverlay dropAnimation={null} modifiers={activeTab ? [snapTabToCursor] : [restrictToVerticalAxis]}>
                {activeTab ? (
                  <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-sm bg-accent shadow-md border border-border opacity-90 pointer-events-none">
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-700 overflow-hidden flex items-center justify-center">
                      {activeTab.favIconUrl && (
                        <img src={activeTab.favIconUrl} alt="" className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="truncate max-w-[200px] text-xs">{activeTab.title}</span>
                  </div>
                ) : activeWindow ? (
                  <div className="border border-border bg-card shadow-lg opacity-90 pointer-events-none px-2 py-1.5 text-xs font-medium">
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
            <div>
              <Button
                variant="outline"
                className={cn('h-7 rounded-none px-3 text-xs w-full', group.windows.length > 0 ? 'mt-0.5' : 'mt-1')}
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
