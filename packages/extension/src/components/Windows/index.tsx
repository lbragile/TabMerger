import React, { useState, useRef, useEffect } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { NEW_WINDOW_SUFFIX } from '@/hooks/useDndHandlers';
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
import type { Group } from '@/lib/types';
import {
  useAddWindow,
  useReplaceWithCurrent,
  useMergeWithCurrent,
  useUniteWindows,
  useSplitWindows,
  useSortTabs,
  useDeleteAllWindows,
  useUpdateGroupNote,
  useRemoveStaleTabs
} from '@/hooks/useGroups';
import { DndProvider, useDndContext } from '@/components/dnd/DndProvider';
import { dndListStyle, gapGrowthFor } from '@/lib/dndInsertion';
import { motionScrollBehavior } from '@/lib/reducedMotion';
import { useUIStore } from '@/stores/uiStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import { getSetting } from '@/lib/localDb';
import { useAppSettings } from '@/hooks/useAppSettings';
import { parseSearchQuery, formatGroupCounts, cn, fuzzyMatch } from '@/lib/utils';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import { moveFocusOutOfSelectionControls } from '@/lib/selectionFocus';
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss';
import { deduplicateTabs } from '@/lib/deduplication';
import { toast } from '@/lib/toast';
import { DEFAULT_GROUP_COLOR } from '@tabmerger/shared';
import { useGroupDisplayColor } from '@/hooks/useGroupDisplayColor';

interface WindowsPanelProps {
  group: Group;
  groupIndex: number;
}

/**
 * "Drop here for a new window" zone — ALWAYS mounted (unmounting it mid-drag
 * would remove a child from an ancestor of the dragged rows and abort the native
 * HTML5 drag in the MV3 popup), shown only while a TAB drag is active. It sits
 * AFTER the windows `SortableContext`, so it is never an ancestor of a tab grip
 * and toggling its visibility / `isOver` class is safe. Dropping a tab here →
 * `useDndHandlers` resolves `${groupId}::new-window` and `dndMove` creates a
 * fresh window in this group containing the tab(s).
 *
 * It is ABSOLUTELY POSITIONED over the "Add Window" button (which is hidden for the
 * whole drag, so the two are never wanted at once). Keeping it in the flow meant an
 * `invisible` 36px box permanently padded the list — the "big gap above Add Window" —
 * while collapsing that box on drag start would resize an ANCESTOR of the dragged row
 * at exactly the moment Chrome aborts a native drag (spec C4). Overlaying costs no
 * layout in either state.
 */
function NewWindowDropZone({
  groupId,
  groupIndex,
  activeForTab
}: {
  groupId: string;
  groupIndex: number;
  activeForTab: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${groupId}${NEW_WINDOW_SUFFIX}`,
    data: { type: 'new-window', groupId, groupIndex },
    disabled: !activeForTab
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="new-window-dropzone"
      aria-hidden={!activeForTab}
      className={cn(
        'absolute inset-0 z-10 flex items-center justify-center border border-dashed text-[11px] font-medium transition-colors',
        // Text in --foreground: primary-tinted 11px text was below 4.5:1 contrast.
        activeForTab
          ? 'border-primary text-foreground bg-background'
          : 'invisible pointer-events-none border-transparent',
        isOver && activeForTab && 'bg-primary/10 border-primary text-foreground'
      )}
    >
      <Plus className="h-3.5 w-3.5 mr-1" />
      Drop here for a new window
    </div>
  );
}

/**
 * Windows panel. Hosts a nesting-aware {@link DndProvider} so it works standalone in
 * tests; in the real app the app-level provider wins and this one is a passthrough.
 * All drag logic lives in the unified layer (`useDndHandlers` + pure `applyMove`) —
 * this component only renders the (possibly reflow-overridden) window/tab tree.
 */
export function WindowsPanel({ group, groupIndex }: WindowsPanelProps) {
  return (
    <DndProvider>
      <WindowsPanelInner group={group} groupIndex={groupIndex} />
    </DndProvider>
  );
}

function WindowsPanelInner({ group: groupProp, groupIndex }: WindowsPanelProps) {
  const dnd = useDndContext();
  // While a drag is live, render from the `onDragOver` working copy (real placeholder reflow).
  const group = dnd.overrideState?.available[groupIndex] ?? groupProp;

  const { mutate: addWindow } = useAddWindow();
  const rawSearchFilter = useUIStore((s) => s.searchFilter);
  const scrollToWindowIndex = useUIStore((s) => s.scrollToWindowIndex);
  const setScrollToWindowIndex = useUIStore((s) => s.setScrollToWindowIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollToWindowIndex === null || activeGroupIndex !== groupIndex) return;
    const el = scrollContainerRef.current?.querySelector<HTMLElement>(`[data-window-index="${scrollToWindowIndex}"]`);
    if (el) el.scrollIntoView({ behavior: motionScrollBehavior(), block: 'nearest' });
    setScrollToWindowIndex(null);
  }, [scrollToWindowIndex, activeGroupIndex, groupIndex, setScrollToWindowIndex]);

  const pendingNoteGroupIndex = useUIStore((s) => s.pendingNoteGroupIndex);
  const setPendingNoteGroupIndex = useUIStore((s) => s.setPendingNoteGroupIndex);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const hasSelection = useUIStore((s) => (s.selectedItems?.length ?? 0) > 0);
  const exitSelectionMode = useUIStore((s) => s.exitSelectionMode);
  const openModal = useUIStore((s) => s.openModal);
  const selectedType = useUIStore((s) => s.selectedItems?.[0]?.type);
  const setSelection = useUIStore((s) => s.setSelection);
  const enterSelectionMode = useUIStore((s) => s.enterSelectionMode);

  // Ctrl/Cmd+A inside the windows panel selects every tab in this group (every window when
  // windows are the current selection type) instead of the page text.
  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'a') return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')) return;
    // Mid-drag, changing the selection would change what the live drag carries.
    if (isDndDragLive()) return;
    e.preventDefault();
    // Only what the user can act on: tabs dimmed out by the search / tag filter and tabs
    // locked by the free-tier limit are skipped (same rules as Tab.tsx / Window.tsx).
    let offset = 0;
    const tabItems = group.windows.flatMap((w, wi) => {
      const base = offset;
      offset += w.tabs.length;
      return w.tabs.flatMap((t, ti) => {
        if (!t) return [];
        const hiddenBySearch = !!searchFilter && !(fuzzyMatch(t.title, searchFilter) || fuzzyMatch(t.url, searchFilter));
        const hiddenByTag = !!tagFilter && !(t.chromeGroup != null && fuzzyMatch(t.chromeGroup.name, tagFilter));
        const locked = isFinite(maxTabs) && base + ti >= maxTabs;
        return hiddenBySearch || hiddenByTag || locked ? [] : [{ type: 'tab' as const, id: `tab-${groupIndex}-${wi}-${ti}` }];
      });
    });
    const items =
      selectedType === 'window'
        ? group.windows.map((_w, wi) => ({ type: 'window' as const, id: `window-${groupIndex}-${wi}` }))
        : tabItems;
    if (items.length === 0) return;
    enterSelectionMode?.();
    setSelection?.(items);
  };

  // Clicking EMPTY panel space (not a window card or a control) clears the selection,
  // same as Escape. NOTE: `useSelectionClickAway` (mounted by App) now exits on a plain
  // click ANYWHERE outside the selection controls, which subsumes this — but the panel
  // also renders standalone (tests, and without the app-level hook), so it stays as the
  // panel's own guarantee. Exiting twice is idempotent.
  const handlePanelClick = (e: React.MouseEvent) => {
    if (!hasSelection) return;
    const target = e.target as Element | null;
    if (target?.closest?.('[data-window-index], button, a, input, textarea, [role="menuitem"]')) return;
    moveFocusOutOfSelectionControls();
    exitSelectionMode?.();
  };

  const handleDeduplicate = () => {
    const allTabs = group.windows.flatMap((w) => w.tabs);
    const { duplicates } = deduplicateTabs(allTabs);
    if (duplicates.length === 0) {
      toast.info('No duplicates found');
      return;
    }
    openModal('deduplicateGroup', { groupIndex, duplicates });
  };

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
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const noteContainerRef = useRef<HTMLDivElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Starting a multi-select closes the panel's own overlays (see `useCloseOnOverlayDismiss`).
  useCloseOnOverlayDismiss(() => {
    setGroupMenuOpen(false);
    setNoteOpen(false);
  });

  const { data: appSettings } = useAppSettings();
  const staleThresholdMs = (appSettings?.staleThresholdDays ?? 30) * 24 * 60 * 60 * 1000;

  const { mutate: removeStaleTabs } = useRemoveStaleTabs();

  const staleCount = group.permanent ? 0 : group.windows.reduce(
    (acc, w) => acc + w.tabs.filter((t) => t.savedAt && Date.now() - t.savedAt > staleThresholdMs).length,
    0
  );

  const doRemoveStaleTabs = () => removeStaleTabs({ groupIndex, staleThresholdMs });

  const handleRemoveStaleTabs = async () => {
    const { confirmOnDelete } = await getSetting('appSettings', { confirmOnDelete: false });
    if (confirmOnDelete) {
      openModal('removeStaleTabs', { count: staleCount, onConfirm: doRemoveStaleTabs });
    } else {
      doRemoveStaleTabs();
    }
  };

  useEffect(() => {
    if (noteOpen) {
      setNoteValue(group.note ?? '');
      setTimeout(() => noteTextareaRef.current?.focus(), 0);
    }
  }, [noteOpen, group.note]);

  // Sidebar's "Add/Edit note" (GroupContextMenu) calls setActiveGroupIndex + stashes this
  // group's index here, since the inline editor it wants to open lives in THIS panel, not
  // the sidebar. Consume + clear once this panel is showing the intended group.
  useEffect(() => {
    if (pendingNoteGroupIndex === groupIndex) {
      setNoteOpen(true);
      setPendingNoteGroupIndex(null);
    }
  }, [pendingNoteGroupIndex, groupIndex, setPendingNoteGroupIndex]);

  const commitGroupNote = () => {
    updateGroupNote({ groupIndex, note: noteValue.trim() });
    setNoteOpen(false);
  };

  const displayColor = useGroupDisplayColor(group);

  const { tabQuery: searchFilter, tagFilter } = parseSearchQuery(rawSearchFilter);

  const windowIds = group.windows.map((_, i) => `${group.id}::w${i}`);

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
                  className="h-6 w-6 hover:opacity-80"
                  style={{ color: displayColor || DEFAULT_GROUP_COLOR }}
                  onClick={() => void handleRemoveStaleTabs()}
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
          {/* Controlled so `useCloseOnOverlayDismiss` can shut it when a multi-select starts. */}
          <DropdownMenu open={groupMenuOpen} onOpenChange={setGroupMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="More group options">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">
              {/* Subset rule (spec: popup-ui-consolidation P1): every item here MUST also
                  exist in GroupContextMenu.tsx with the identical label and handler. Group
                  *identity* operations (Rename, AI rename, Duplicate, Archive, Delete) are
                  deliberately absent — they stay context-menu-only. Do not reintroduce an
                  item here without adding its twin there, and vice versa for the shared set. */}
              <DropdownMenuItem onClick={() => setNoteOpen((o) => !o)}>
                <StickyNote className="h-3.5 w-3.5 mr-2 shrink-0" />
                {group.note ? 'Edit note' : 'Add note'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Replace with current</div><div className="text-[10px] text-muted-foreground font-normal">Swap all windows with your open browser session</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
                <GitMerge className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Merge with current</div><div className="text-[10px] text-muted-foreground font-normal">Add your open browser windows to this group</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
                <Layers className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Unite windows</div><div className="text-[10px] text-muted-foreground font-normal">Combine all windows into one</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
                <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Split windows</div><div className="text-[10px] text-muted-foreground font-normal">Move each tab into its own window</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Sort by title</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort all tabs by name</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>Sort by URL</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort all tabs by address</div></div>
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

      <div
        ref={scrollContainerRef}
        className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden"
        data-testid="windows-panel-scroll"
        onClick={handlePanelClick}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="p-2">
          {/* List wrapper: grows by the gap height while a window drag's gap is here
              (see `gapGrowthFor`). Always mounted — never toggled mid-drag. */}
          <div data-tm-dnd-list="" style={dndListStyle(gapGrowthFor(dnd.gap, group.id), '0px')}>
          <SortableContext items={windowIds} strategy={verticalListSortingStrategy}>
            {group.windows.reduce<{ els: React.ReactNode[]; offset: number }>(
              ({ els, offset }, window, windowIndex) => ({
                els: [
                  ...els,
                  <WindowItem
                    key={windowIds[windowIndex]}
                    groupId={group.id}
                    window={window}
                    groupIndex={groupIndex}
                    windowIndex={windowIndex}
                    siblingCount={group.windows.length}
                    tabIds={window.tabs.filter(Boolean).map((_t, ti) => `${group.id}::w${windowIndex}::t${ti}`)}
                    groupColor={displayColor}
                    isBeingDragged={
                      dnd.active?.type === 'window' &&
                      dnd.active.groupIndex === groupIndex &&
                      dnd.active.windowIndex === windowIndex
                    }
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
          </div>

          {group.windows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No windows in this group</p>
          )}

          {group.permanent ? (
            // Now Open mirrors the LIVE browser (`useCurrentTabs`), so "Add Window" must
            // open a REAL Chrome window, not push an empty window into stored state — a
            // stored-only window would be overwritten (and vanish) on the next
            // `useCurrentTabs` sync, and would desync Now Open from reality in the
            // meantime. The new window (New Tab page) is picked up by the next sync tick
            // automatically — `syncNowOpen` only drops empty windows (0 tabs) and the
            // extension's own pages, neither of which applies to a fresh `chrome://newtab`
            // window. The "new window" drop zone IS enabled here (unlike the earlier
            // decision to leave it out): dropping a live Now Open tab onto it is a real
            // `chrome.windows.create({tabId})` detach, and dropping a saved tab onto it
            // opens it as a real tab in one new unfocused window — see `dndMove.ts`'s
            // Now Open delegation and `runSideEffects`'s `tabs.detachToNewWindow`. Both
            // children stay MOUNTED for the whole drag (C4).
            <div className="relative">
              <NewWindowDropZone
                groupId={group.id}
                groupIndex={groupIndex}
                activeForTab={dnd.active?.type === 'tab'}
              />
              <div className={cn(dnd.isDragging && 'invisible')}>
                <Button
                  variant="outline"
                  className="h-7 rounded-none px-3 text-xs w-full"
                  onClick={() => { void chrome.windows.create({}); }}
                  disabled={selectionMode || dnd.isDragging}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Window
                </Button>
              </div>
            </div>
          ) : (
            // "Add Window" + the new-window drop zone share ONE box (the zone overlays
            // the button). NO margin of its own: every window card already carries
            // `mb-2`, so the gap above the button is exactly 8px — the SAME 8px the
            // sidebar's `mt-2` puts above "Add Group" (group rows have no margin).
            // Both children stay MOUNTED for the whole drag: unmounting either removes a
            // child from an ANCESTOR of the dragged row, which aborts the native HTML5
            // drag in the MV3 popup (C4).
            <div className="relative">
              <NewWindowDropZone
                groupId={group.id}
                groupIndex={groupIndex}
                activeForTab={dnd.active?.type === 'tab'}
              />
              <div className={cn(dnd.isDragging && 'invisible')}>
                <Button
                  variant="outline"
                  className="h-7 rounded-none px-3 text-xs w-full"
                  onClick={() => addWindow({ groupIndex })}
                  disabled={selectionMode || dnd.isDragging}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Window
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
