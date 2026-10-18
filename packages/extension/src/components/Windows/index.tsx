import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useKeyboardMoveStore } from '@/stores/keyboardMoveStore';
import { useEntitlements } from '@/hooks/useEntitlements';
import { getSetting } from '@/lib/localDb';
import { useAppSettings } from '@/hooks/useAppSettings';
import { parseSearchQuery, formatGroupCounts, cn } from '@/lib/utils';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import { moveFocusOutOfSelectionControls } from '@/lib/selectionFocus';
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss';
import { findDuplicateTabs } from '@/lib/deduplication';
import { toast } from '@/lib/toast';
import { DEFAULT_GROUP_COLOR } from '@tabmerger/shared';
import { useGroupDisplayColor } from '@/hooks/useGroupDisplayColor';
import { KEYBOARD_ZONE_MIN_HEIGHT } from '@/lib/keyboardMoveDom';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import { isHiddenFromSearch } from '@/lib/tourSandbox';
import { useTourSearchShowsDemo } from '@/hooks/useTourSearchShowsDemo';
import { SEARCH_NON_MATCHING } from '@tabmerger/shared';
import { PanelSearchContext, buildPanelSearchView, useSearchFilters, useSearchMode } from '@/hooks/useSearchView';
import { useKeepFocusInList, SEARCH_STATUS_CLEAR_ATTR } from '@/hooks/useKeepFocusInList';
import { groupSearchState, isSearchActive, summarizeSearch, tabMatchesFilters } from '@/lib/searchMatch';

interface WindowsPanelProps {
  group: Group;
  groupIndex: number;
  /** Every group, for the "matches in other groups" count of a search. Optional: the panel also renders on its own. */
  allGroups?: Group[];
}

/** The typed query as shown back to the user: plain text, cut short so it cannot fill the panel. */
const shortQuery = (q: string) => (q.length > 60 ? `${q.slice(0, 60)}…` : q);

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
  const { t } = useTranslation();
  const { setNodeRef, isOver: pointerOver } = useDroppable({
    id: `${groupId}${NEW_WINDOW_SUFFIX}`,
    data: { type: 'new-window', groupId, groupIndex },
    disabled: !activeForTab
  });
  // Keyboard move mode highlights the zone it targets exactly as a pointer hover does.
  const keyboardOver = useKeyboardMoveStore((s) => s.marker?.type === 'zone' && s.marker.zone === 'new-window');
  const isOver = pointerOver || keyboardOver;
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
        isOver && activeForTab && 'bg-primary/10 border-primary text-foreground',
        // Keyboard target: the label drops to the bottom so the docked copy fits above it.
        keyboardOver && 'items-end pb-1'
      )}
    >
      <Plus className="h-3.5 w-3.5 mr-1" />
      {t('windows.dropNewWindow')}
    </div>
  );
}

/**
 * Windows panel. Hosts a nesting-aware {@link DndProvider} so it works standalone in
 * tests; in the real app the app-level provider wins and this one is a passthrough.
 * All drag logic lives in the unified layer (`useDndHandlers` + pure `applyMove`) —
 * this component only renders the (possibly reflow-overridden) window/tab tree.
 */
export function WindowsPanel({ group, groupIndex, allGroups }: WindowsPanelProps) {
  return (
    <DndProvider>
      <WindowsPanelInner group={group} groupIndex={groupIndex} allGroups={allGroups} />
    </DndProvider>
  );
}

function WindowsPanelInner({ group: groupProp, groupIndex, allGroups }: WindowsPanelProps) {
  const { t } = useTranslation();
  const dnd = useDndContext();
  const moveKind = useKeyboardMoveStore((s) => s.kind);
  // Keyboard move on the "new group" stop: the shown group is NOT where the item will land, so dim it.
  const atNewWindowStop = useKeyboardMoveStore((s) => s.marker?.type === 'zone' && s.marker.zone === 'new-window');
  const atNewGroupStop = useKeyboardMoveStore((s) => s.marker?.type === 'zone' && s.marker.zone === 'new-group');
  // While a drag is live, render from the `onDragOver` working copy (real placeholder reflow).
  const group = dnd.overrideState?.available[groupIndex] ?? groupProp;

  const { mutate: addWindow } = useAddWindow();
  const rawSearchFilter = useUIStore((s) => s.searchFilter);
  const setSearchFilter = useUIStore((s) => s.setSearchFilter);
  // Search as it applies to THIS group: what matches (by real index), and whether the rest is
  // hidden or faded. A group search must leave out (the tour's practice groups, outside the
  // tour's own search steps) gets no search state: its rows only fade, as they always have.
  const filters = useSearchFilters();
  const searchMode = useSearchMode();
  // `isHiddenFromSearch` reads a flag the tour flips with its steps: re-evaluate on a step change.
  const searchShowsDemo = useTourSearchShowsDemo();
  const searchState = useMemo(
    () => (isSearchActive(filters) && !isHiddenFromSearch(group) ? groupSearchState(group, filters) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, filters, searchShowsDemo]
  );
  const searchView = useMemo(() => buildPanelSearchView(filters, searchMode, searchState), [filters, searchMode, searchState]);
  const otherGroups = useMemo(() => {
    if (!searchState || !allGroups) return null;
    const all = summarizeSearch(allGroups, filters);
    return {
      tabs: Math.max(0, all.matchingTabs - searchState.matchCount),
      groups: Math.max(0, all.groupsWithMatches - (searchState.matchCount > 0 ? 1 : 0))
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGroups, filters, searchState, searchShowsDemo]);

  const clearSearch = () => {
    // The button that was clicked is about to go away: put focus on the search box's opener
    // before it does, so it never falls back to <body>.
    document.querySelector<HTMLElement>(`button[data-tour="${TOUR_ANCHORS.search}"]`)?.focus();
    setSearchFilter?.('');
  };
  const scrollToWindowIndex = useUIStore((s) => s.scrollToWindowIndex);
  const setScrollToWindowIndex = useUIStore((s) => s.setScrollToWindowIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // A focused row that search hides, or a "Now Open" row whose browser tab closed, hands focus
  // to its nearest neighbor instead of dropping it on the page
  const keepFocus = useKeepFocusInList(scrollContainerRef, searchView.hide || !!group.permanent);

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
        const hiddenBySearch = !!searchFilter && !tabMatchesFilters(t, { tabQuery: searchFilter, tagFilter: '' });
        const hiddenByTag = !!tagFilter && !tabMatchesFilters(t, { tabQuery: '', tagFilter });
        // The panel's own search state (also knows `window:` / `group:` filters) wins when there is one.
        const filteredOut = searchState ? searchState.windows[wi]?.tabMatches[ti] === false : hiddenBySearch || hiddenByTag;
        const locked = isFinite(maxTabs) && base + ti >= maxTabs;
        return filteredOut || locked ? [] : [{ type: 'tab' as const, id: `tab-${groupIndex}-${wi}-${ti}` }];
      });
    });
    const items =
      selectedType === 'window'
        ? group.windows.flatMap((_w, wi) =>
            // A window the search has taken off the screen is never selected.
            searchView.hide && searchState?.windows[wi]?.visible === false ? [] : [{ type: 'window' as const, id: `window-${groupIndex}-${wi}` }]
          )
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
    const duplicates = findDuplicateTabs(group.windows);
    if (duplicates.length === 0) {
      toast.info(t('groupMenu.toast.noDuplicates'));
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

  const handleDeleteAllWindows = async () => {
    const doDeleteAll = () => deleteAllWindows({ groupIndex });
    const { confirmOnDelete } = await getSetting('appSettings', { confirmOnDelete: false });
    if (confirmOnDelete) {
      openModal('removeAllWindows', { isNowOpen: !!group.permanent, onConfirm: doDeleteAll });
    } else {
      doDeleteAll();
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

  // The quiet line under the toolbar while a search is active.
  const hiddenTabs = searchState ? searchState.tabCount - searchState.matchCount : 0;
  const nothingToShow = !!searchState && !searchState.windows.some((w) => w.visible);
  const elsewhere =
    otherGroups && otherGroups.tabs > 0
      ? t('windows.search.elsewhere', { tabs: t('windows.search.matchingTabs', { count: otherGroups.tabs }), groups: t('windows.search.otherGroups', { count: otherGroups.groups }) })
      : null;
  const searchStatus = !searchState
    ? ''
    : nothingToShow
      ? t('windows.search.noneInGroup')
      : searchMode === SEARCH_NON_MATCHING.HIDE
        ? hiddenTabs > 0
          ? t('windows.search.hidden', { count: hiddenTabs })
          : t('windows.search.allMatch', { count: searchState.tabCount })
        : t('windows.search.someMatch', { matched: searchState.matchCount, count: searchState.tabCount });

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden" data-tour={TOUR_ANCHORS.tabsPanel}>
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
                  aria-label={t('windows.removeStale', { count: staleCount })}
                >
                  <Clock className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('windows.removeStale', { count: staleCount })}</TooltipContent>
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
                  aria-label={t('windows.editGroupNote')}
                >
                  <StickyNote className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('windows.editNote')}</TooltipContent>
            </Tooltip>
          )}
          {/* Controlled so `useCloseOnOverlayDismiss` can shut it when a multi-select starts. */}
          <DropdownMenu open={groupMenuOpen} onOpenChange={setGroupMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" aria-label={t('windows.moreGroupOptions')} data-tour={TOUR_ANCHORS.groupOptions}>
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
                {group.note ? t('groupMenu.editNote') : t('groupMenu.addNote')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => replaceWithCurrent(groupIndex)}>
                <RefreshCw className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.replaceWithCurrent')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.replaceWithCurrentHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => mergeWithCurrent(groupIndex)}>
                <GitMerge className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.mergeWithCurrent')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.mergeWithCurrentHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => uniteWindows(groupIndex)}>
                <Layers className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.uniteWindows')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.uniteWindowsHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => splitWindows(groupIndex)}>
                <SplitSquareHorizontal className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.splitWindows')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.splitWindowsHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.sortByTitle')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.sortByTitleHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.sortByUrl')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.sortByUrlHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDeduplicate}>
                <Copy className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div><div>{t('groupMenu.deduplicate')}</div><div className="text-[10px] text-muted-foreground font-normal">{t('groupMenu.deduplicateHint')}</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                onClick={() => void handleDeleteAllWindows()}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div>
                  <div>{group.permanent ? t('groupMenu.closeAllWindows') : t('groupMenu.removeAllWindows')}</div>
                  <div className="text-[10px] font-normal opacity-60">
                    {group.permanent ? t('groupMenu.closeAllWindowsHint') : t('groupMenu.removeAllWindowsHint')}
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
            placeholder={t('windows.notePlaceholder')}
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNoteOpen(false);
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitGroupNote();
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{t('windows.noteLength', { length: noteValue.length, max: 500 })}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => setNoteOpen(false)}>{t('common.cancel')}</Button>
              <Button size="sm" className="h-5 text-[10px] px-2" onClick={commitGroupNote}>{t('common.save')}</Button>
            </div>
          </div>
        </div>
      )}

      {searchView.active && (
        <div
          className="flex items-center justify-between gap-2 min-w-0 px-3 py-1 border-b border-border shrink-0 text-[11px] text-muted-foreground"
          data-testid="search-status"
        >
          <span className="truncate min-w-0">
            {nothingToShow && elsewhere ? t('windows.search.statusElsewhere', { status: searchStatus, elsewhere }) : searchStatus}
          </span>
          <Button variant="link" size="sm" className="h-5 px-0 text-[11px] shrink-0" onClick={clearSearch} {...{ [SEARCH_STATUS_CLEAR_ATTR]: '' }}>
            {t('search.clearSearch')}
          </Button>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className={cn('flex-1 min-w-0 overflow-y-auto overflow-x-hidden transition-opacity', atNewGroupStop && 'opacity-40')}
        data-testid="windows-panel-scroll"
        onFocusCapture={keepFocus.onFocusCapture}
        onBlurCapture={keepFocus.onBlurCapture}
        onClick={handlePanelClick}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="p-2">
          {/* List wrapper: grows by the gap height while a window drag's gap is here
              (see `gapGrowthFor`). Always mounted — never toggled mid-drag. */}
          <div data-tm-dnd-list={group.id} style={dndListStyle(gapGrowthFor(dnd.gap, group.id), '0px')}>
          <PanelSearchContext.Provider value={searchView}>
          <SortableContext items={windowIds} strategy={verticalListSortingStrategy}>
            {group.windows.reduce<{ els: React.ReactNode[]; offset: number }>(
              ({ els, offset }, window, windowIndex) => ({
                els: [
                  ...els,
                  // "Hide" mode: a window with nothing to show is not rendered. `windowIndex`
                  // and the tab offset still count it, so the rows that are shown keep their real positions.
                  searchView.hide && searchState?.windows[windowIndex]?.visible === false ? null :
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
          </PanelSearchContext.Provider>
          </div>

          {searchView.hide && nothingToShow && group.windows.length > 0 && (
            <div className="py-6 px-3 text-center min-w-0" data-testid="search-empty">
              <p className="text-sm text-muted-foreground break-words">
                {t('windows.search.noneForQuery', { query: shortQuery(rawSearchFilter.trim()) })}
              </p>
              {elsewhere && <p className="mt-1 text-xs text-muted-foreground">{elsewhere}</p>}
              <Button variant="outline" size="sm" className="mt-3 h-7 rounded-none px-3 text-xs" onClick={clearSearch}>
                {t('search.clearSearch')}
              </Button>
            </div>
          )}

          {group.windows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('windows.noWindows')}</p>
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
            <div className={cn('relative', atNewWindowStop && KEYBOARD_ZONE_MIN_HEIGHT)}>
              <NewWindowDropZone
                groupId={group.id}
                groupIndex={groupIndex}
                activeForTab={dnd.active?.type === 'tab' || moveKind === 'tab'}
              />
              <div className={cn((dnd.isDragging || moveKind !== null) && 'invisible')}>
                <Button
                  variant="outline"
                  className="h-7 rounded-none px-3 text-xs w-full"
                  onClick={() => { void chrome.windows.create({}); }}
                  disabled={selectionMode || dnd.isDragging}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('windows.addWindow')}
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
            <div className={cn('relative', atNewWindowStop && KEYBOARD_ZONE_MIN_HEIGHT)}>
              <NewWindowDropZone
                groupId={group.id}
                groupIndex={groupIndex}
                activeForTab={dnd.active?.type === 'tab' || moveKind === 'tab'}
              />
              <div className={cn((dnd.isDragging || moveKind !== null) && 'invisible')}>
                <Button
                  variant="outline"
                  className="h-7 rounded-none px-3 text-xs w-full"
                  onClick={() => addWindow({ groupIndex })}
                  disabled={selectionMode || dnd.isDragging}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('windows.addWindow')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
