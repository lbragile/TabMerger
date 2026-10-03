import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, MoveRight, CheckSquare, Square, GripVertical, Lock, StickyNote, Clock, Pencil, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TabPreview } from './TabPreview';
import { CreateGroupMenuItem } from './CreateGroupMenuItem';
import type { Tab as TabType } from '@/lib/types';
import { useDeleteTab, useMoveTab, useGroups, useUpdateTabNote, useSetTabReminder, useClearTabReminder, GROUPS_QUERY_KEY } from '@/hooks/useGroups';
import { useUrlRules, matchUrlToRule } from '@/hooks/useUrlRules';
import { useUIStore } from '@/stores/uiStore';
import { cn, fuzzyMatch } from '@/lib/utils';
import { isDndDragLive } from '@/lib/dndMultiDrag';
import { startMoveOnSpace, toggleSelectionOnCtrlSpace } from '@/lib/keyboardMoveEntry';
import { openTabInChromeGroup } from '@/lib/chromeGroups';
import { getDisplayTitle, setTabCustomTitle } from '@/lib/tabTitle';
import { useQueryClient } from '@tanstack/react-query';
import type { GroupsState } from '@/lib/types';
import { DEFAULT_GROUP_COLOR } from '@tabmerger/shared';
import { useDndContext } from '@/components/dnd/DndProvider';
import { gapTransformFor } from '@/lib/dndInsertion';
import { DND_POINTER_PROBE_ACTIVE } from '@/lib/dndPointerProbe';
import { selectionRange } from '@/lib/selectionRange';
import { useRovingRow } from '@/hooks/useRovingRow';
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss';

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E";

// ponytail: group colors are stored as rgba(...) strings; swap the alpha for a low-opacity pill background
function withAlpha(rgba: string, alpha: number): string {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return rgba;
  const [r, g, b] = m[1].split(',').map((s) => s.trim());
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ponytail: hostname + path (no query/hash) display; column already truncates via CSS
function getUrlDisplay(url?: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const hostname = u.hostname.replace(/^www\./, '');
    let path = u.pathname.replace(/\/$/, '');
    if (path.length > 15) path = `${path.slice(0, 15)}...`;
    return path ? `${hostname}${path}` : hostname;
  } catch {
    return '';
  }
}

const CHROME_GROUP_COLOR_MAP: Record<string, string> = {
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#e52592',
  purple: '#8430ce',
  cyan: '#007b83',
  orange: '#fa903e',
  grey: '#80868b',
  gray: '#80868b'
};
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

interface TabItemProps {
  /** parent group's model id — tab sortable id is `${groupId}::w${windowIndex}::t${tabIndex}` */
  groupId?: string;
  tab: TabType;
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
  siblingCount: number;
  /** @deprecated vestigial — the unified SortableContext no longer needs drag-suppression hints */
  isDraggingTab?: boolean;
  /** @deprecated vestigial */
  activeWindowIndex?: number | null;
  searchFilter?: string;
  tagFilter?: string;
  groupColor?: string;
  isLocked?: boolean;
  staleThresholdMs?: number;
}

export function TabItem({ groupId, tab, groupIndex, windowIndex, tabIndex, siblingCount: _siblingCount, searchFilter, tagFilter, groupColor, isLocked = false, staleThresholdMs }: TabItemProps) {
  const sortableId = `${groupId}::w${windowIndex}::t${tabIndex}`;
  // `transition` is intentionally discarded — see drag-and-drop spec §8 (no live dnd-kit
  // transform/transition on a dragged row; an insertion gap is rendered instead).
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: sortableId,
    data: { type: 'tab', groupId, windowId: `${groupId}::w${windowIndex}` }
  });
  const { gap, active: dndActive } = useDndContext();
  const keyboardDrag = dndActive?.keyboard === true;
const { mutate: deleteTab } = useDeleteTab();
  const { mutate: moveTab } = useMoveTab();
  const { data: urlRules = [] } = useUrlRules();
  const { mutate: updateTabNote } = useUpdateTabNote();
  const { mutate: setTabReminder } = useSetTabReminder();
  const { mutate: clearTabReminder } = useClearTabReminder();
  const { data: groupsState } = useGroups();
  const queryClient = useQueryClient();
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteValue, setNoteValue] = useState('');
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderNote, setReminderNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const noteContainerRef = useRef<HTMLDivElement>(null);
  const reminderContainerRef = useRef<HTMLDivElement>(null);

  // Starting a multi-select closes this row's context menu and its inline note / reminder
  // editors — they sit over the rows the user is about to tick. The title RENAME input is
  // deliberately left alone: closing it would silently discard what was typed.
  useCloseOnOverlayDismiss(() => {
    setContextMenuOpen(false);
    setNoteOpen(false);
    setReminderOpen(false);
  });
  useEffect(() => {
    if (!editingTitle) return;
    const id = setTimeout(() => {
      const el = titleInputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 50);
    return () => clearTimeout(id);
  }, [editingTitle]);

  // Focus textarea when note editor opens
  useEffect(() => {
    if (noteOpen) {
      setNoteValue(tab.note ?? '');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [noteOpen, tab.note]);

  const commitNote = () => {
    updateTabNote({ groupIndex, windowIndex, tabIndex, note: noteValue.trim() });
    setNoteOpen(false);
  };

  const commitTitle = async (value: string) => {
    setEditingTitle(false);
    const trimmed = value.trim();
    // Address the group by ID: the positional index came from the render this click belongs to.
    const groupId = queryClient.getQueryData<GroupsState>(GROUPS_QUERY_KEY)?.available[groupIndex]?.id;
    if (!groupId) return;
    // Atomic read-modify-write that also marks the group for sync (see setTabCustomTitle).
    queryClient.setQueryData(GROUPS_QUERY_KEY, await setTabCustomTitle(groupId, windowIndex, tabIndex, trimmed));
  };

  const handleNoteBlur = (e: React.FocusEvent) => {
    // Don't commit if focus moved to another element inside the note container
    if (noteContainerRef.current?.contains(e.relatedTarget as Node)) return;
    commitNote();
  };

  const selectionMode = useUIStore((s) => s.selectionMode);
  // Drag-handle wiring from @dnd-kit. The unified sensor set (see useDnd.ts +
  // @/lib/dndHtml5Sensor) activates on the NATIVE `onDragStart` event, which
  // dnd-kit puts in `listeners` — so the handle must ALSO be `draggable` (dnd-kit
  // never sets that attr). Native HTML5 drag is the only sensing that works in
  // the real MV3 toolbar popup (it withholds the pointermove stream). The extra
  // `onMouseDown` below only stops the press bubbling to row-level handlers (row
  // click / selection); it composes any `onMouseDown` `listeners` might carry.
  // The grip stays live in selection mode: dragging a SELECTED row drags the whole
  // selection (multi-drag), so the checkbox sits next to the grip instead of replacing it.
  // Roving tabindex (a11y M3): the ROW is the only Tab stop; Left/Right walk its controls.
  // `roving.ref` composes with dnd-kit's sortable ref on the row element.
  const roving = useRovingRow<HTMLDivElement>();
  const setRowRef = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    roving.ref(node);
  };

  const dragHandleProps = { ...attributes, ...listeners };
  /**
   * Shift+Space on the grip = range select (the keyboard Shift+click); plain Space starts
   * keyboard move mode (Enter never does).
   */
  const onDragHandleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === ' ' || e.code === 'Space') && e.shiftKey && !isDndDragLive()) {
      e.preventDefault();
      e.stopPropagation();
      extendRange();
      return;
    }
    // Ctrl+Space toggles the tab in the selection; plain Space starts keyboard move mode.
    if (toggleSelectionOnCtrlSpace(e, { type: 'tab', id: `tab-${groupIndex}-${windowIndex}-${tabIndex}` })) return;
    startMoveOnSpace(e, 'tab', sortableId);
  };
  const onDragHandleMouseDown = (e: React.MouseEvent) => {
    (dragHandleProps as { onMouseDown?: (e: React.MouseEvent) => void }).onMouseDown?.(e);
    e.stopPropagation();
  };
  const selectedItems = useUIStore((s) => s.selectedItems);
  const toggleSelection = useUIStore((s) => s.toggleSelection);
  const enterSelectionMode = useUIStore((s) => s.enterSelectionMode);
  const selectRange = useUIStore((s) => s.selectRange);
  const selectionAnchor = useUIStore((s) => s.selectionAnchor);
  const renameTarget = useUIStore((s) => s.renameTarget);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);
  const noteTarget = useUIStore((s) => s.noteTarget);
  const setNoteTarget = useUIStore((s) => s.setNoteTarget);

  // Global keyboard shortcuts (F2 rename, N add-note) signal this specific tab row via uiStore
  // since editingTitle/noteOpen are local component state — consume + clear on match.
  useEffect(() => {
    if (
      renameTarget?.kind === 'tab' &&
      renameTarget.groupIndex === groupIndex &&
      renameTarget.windowIndex === windowIndex &&
      renameTarget.tabIndex === tabIndex
    ) {
      setTitleValue(getDisplayTitle(tab));
      setEditingTitle(true);
      setRenameTarget(null);
    }
  }, [renameTarget, groupIndex, windowIndex, tabIndex, tab, setRenameTarget]);

  useEffect(() => {
    if (
      noteTarget?.groupIndex === groupIndex &&
      noteTarget.windowIndex === windowIndex &&
      noteTarget.tabIndex === tabIndex
    ) {
      setNoteOpen(true);
      setNoteTarget(null);
    }
  }, [noteTarget, groupIndex, windowIndex, tabIndex, setNoteTarget]);

  // `Html5DragSensor` runs a NATIVE HTML5 drag. In the MV3 toolbar popup Chrome
  // aborts it the instant the dragged row (an ancestor of the grip) mutates —
  // a `transform`, a `class`, or a `style` change all count. So the dragged row:
  //   - never gets a live `transform` (`isDragging ? undefined`) — the ghost moves
  //   - uses a STABLE `transition` string (dnd-kit's value flips mid-drag)
  //   - does NOT toggle any `isDragging` class (see className below)
  // Sibling rows animate via the insertion-gap transform while a native drag has
  // collapsed its source row (`gap`), else via their strategy `transform`.
  const gapTransform = gapTransformFor(gap, sortableId);
  // A KEYBOARD drag has no native session (C4 doesn't apply) and no ghost, so there the
  // dragged row DOES follow dnd-kit's transform — otherwise a sighted keyboard user sees nothing move.
  const style = {
    transform: isDragging && !keyboardDrag ? undefined : gapTransform !== null ? gapTransform : CSS.Transform.toString(transform),
    transition: 'transform 200ms ease'
  };

  const handleOpen = async (e?: React.MouseEvent) => {
    if (isLocked) return;
    // Skip opening the tab when Ctrl/Cmd/Shift is held — those gestures are for selection
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
    if (!tab.url) return;
    if (tab.chromeGroup && chrome.tabGroups) {
      await openTabInChromeGroup(tab, undefined, true);
      return;
    }
    chrome.tabs.create({ url: tab.url, active: true });
  };

  // 6b: reopen all tabs in this Chrome group as a new Chrome tab group
  const handleReopenGroup = async () => {
    if (!tab.chromeGroup || !chrome.tabGroups) return;
    const siblings = groupsState?.available[groupIndex]?.windows[windowIndex]?.tabs ?? [];
    const groupTabs = siblings.filter((t) => t.chromeGroup?.id === tab.chromeGroup!.id && t.url);
    if (groupTabs.length === 0) return;
    const newTabs = await Promise.all(groupTabs.map((t) => chrome.tabs.create({ url: t.url!, active: false })));
    const tabIds = newTabs.map((t) => t.id).filter((id): id is number => id !== undefined);
    if (tabIds.length === 0) return;
    const newGroupId = await (chrome.tabs.group({ tabIds: tabIds as [number, ...number[]] }) as Promise<number>);
    await chrome.tabGroups.update(newGroupId, {
      title: tab.chromeGroup.name,
      color: tab.chromeGroup.color as chrome.tabGroups.Color
    });
  };

  const isHighlighted =
    searchFilter &&
    (fuzzyMatch(tab.title, searchFilter) || fuzzyMatch(tab.url, searchFilter));
  // 6c: tag filter — tab must match chromeGroup name if tagFilter is set
  const tagMatch = !tagFilter || (tab.chromeGroup != null && fuzzyMatch(tab.chromeGroup.name, tagFilter));

  // Build list of groups this tab can be moved to (all except the current group and archived groups)
  const targetGroups =
    groupsState?.available
      .map((g, i) => ({ group: g, index: i }))
      .filter(({ group, index }) => index !== groupIndex && !group.archived) ?? [];

  // When the source is Now Open (permanent), copy the tab instead of moving it
  const isNowOpen = groupsState?.available[groupIndex]?.permanent ?? false;

  const isStale =
    !isNowOpen &&
    !!staleThresholdMs &&
    !!tab.savedAt &&
    Date.now() - tab.savedAt > staleThresholdMs;

  // Selection state for this tab
  const committedType = selectedItems[0]?.type ?? null;
  const showCheckbox = selectionMode && (!committedType || committedType === 'tab');
  const selectionId = `tab-${groupIndex}-${windowIndex}-${tabIndex}`;
  const isSelected = selectedItems.some((s) => s.id === selectionId);

  const tabTitle = getDisplayTitle(tab) || tab.url || 'tab';

  const extendRange = () => {
    const item = { type: 'tab' as const, id: selectionId };
    selectRange(item, selectionRange(groupsState, selectionAnchor, item));
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    // Shift on the checkbox (click, or Shift+Space with it focused) extends a range.
    if (e.shiftKey) {
      extendRange();
      return;
    }
    toggleSelection({ type: 'tab', id: selectionId });
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Shift+click extends the selection from the anchor to this tab (visual order; may
    // span windows, never groups — see `selectionRange`)
    if (e.shiftKey) {
      e.stopPropagation();
      e.preventDefault();
      const item = { type: 'tab' as const, id: selectionId };
      selectRange(item, selectionRange(groupsState, selectionAnchor, item));
      return;
    }
    // Ctrl/Cmd+click anywhere on the row enters selection and toggles this tab
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      e.preventDefault();
      enterSelectionMode();
      toggleSelection({ type: 'tab', id: selectionId });
    }
  };

  return (
    <>
    <div
      ref={setRowRef}
      style={style}
      className={cn(
        'group relative flex items-center gap-1 min-w-0 px-1.5 py-0.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isLocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent/50 cursor-pointer',
        // NOTE: no `isDragging` class here on purpose — mutating the dragged row's
        // className mid-drag aborts the native HTML5 drag in the MV3 popup. The
        // ghost card is the drag affordance.
        searchFilter && !isHighlighted && 'opacity-30',
        tagFilter && !tagMatch && 'opacity-30',
        // Selected: tint + a 3px inset bar in --foreground (the old 50% primary ring was ~1.7:1).
        // `isSelected` never flips synchronously inside `dragstart` (clearing is rAF-deferred).
        isSelected && 'bg-primary/10 shadow-[inset_3px_0_0_0_var(--color-foreground)]',
        // KEYBOARD drags only (no native session → C4 doesn't apply): lift the dragged row and
        // mark the other selected rows travelling with it.
        isDragging && keyboardDrag && 'relative z-10 bg-card shadow-lg ring-2 ring-ring',
        keyboardDrag &&
          !isDragging &&
          dndActive?.selectionIds?.includes(sortableId) &&
          'outline-dashed outline-1 -outline-offset-1 outline-foreground'
      )}
      tabIndex={0}
      role="listitem"
      aria-label={getDisplayTitle(tab) || tab.url}
      data-group-index={groupIndex}
      data-window-index={windowIndex}
      data-tab-index={tabIndex}
      data-tm-dnd-id={sortableId}
      onClick={handleRowClick}
      // Shift+click must not extend the browser's TEXT selection across rows.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onKeyDown={(e) => {
        // Roving tabindex FIRST: Left/Right/Home/End move between this row's controls.
        // Inert mid-drag, so dnd-kit still gets those keys (spec C13).
        roving.onKeyDown(e);
        if (e.defaultPrevented) return;
        // Only the row ITSELF activates. Keys from nested controls bubble up here, and
        // dnd-kit's keyboard activator on the grip calls `preventDefault` but NOT
        // `stopPropagation` — without this, a Space/Enter pickup or drop on the grip (or
        // Space on the checkbox) would also open the tab and dismiss the popup.
        if (e.target !== e.currentTarget) return;
        // Shift+Space on a focused row: keyboard equivalent of Shift+click (range select).
        if (e.key === ' ' && e.shiftKey && !editingTitle) {
          e.preventDefault();
          extendRange();
          return;
        }
        // Ctrl+Space toggles the selection without opening or moving; plain Space picks the
        // tab up (keyboard move); Enter stays "open".
        if (!editingTitle && toggleSelectionOnCtrlSpace(e, { type: 'tab', id: selectionId })) return;
        if (!editingTitle && startMoveOnSpace(e, 'tab', sortableId)) return;
        if ((e.key === 'Enter' || e.key === ' ') && !isLocked && !editingTitle) {
          e.preventDefault();
          void handleOpen();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenuOpen(true);
      }}
    >
      {/* Context menu — zero-size trigger positioned absolutely so it doesn't affect layout */}
      <DropdownMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen}>
        <DropdownMenuTrigger
          className="absolute inset-0 w-full h-full pointer-events-none opacity-0 focus:outline-none"
          tabIndex={-1}
          aria-hidden="true"
        />
        <DropdownMenuContent className="w-48 text-xs" align="start" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">
              <MoveRight className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              {isNowOpen ? 'Copy to group' : 'Move to group'}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-48 overflow-y-auto">
              {targetGroups.map(({ group, index }) => (
                <DropdownMenuItem
                  key={group.id}
                  className="text-xs"
                  onClick={() =>
                    moveTab({
                      fromGroupIndex: groupIndex,
                      fromWindowIndex: windowIndex,
                      fromTabIndex: tabIndex,
                      toGroupIndex: index,
                      copy: isNowOpen
                    })
                  }
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0 mr-2"
                    style={{ backgroundColor: group.color }}
                  />
                  <span className="truncate">{group.name}</span>
                </DropdownMenuItem>
              ))}
              {targetGroups.length === 0 && (
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  No other groups
                </DropdownMenuItem>
              )}
              <CreateGroupMenuItem
                onCreated={(index) =>
                  moveTab({
                    fromGroupIndex: groupIndex,
                    fromWindowIndex: windowIndex,
                    fromTabIndex: tabIndex,
                    toGroupIndex: index,
                    copy: isNowOpen
                  })
                }
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {isNowOpen && urlRules.length > 0 && (() => {
            const matchedGroupId = matchUrlToRule(tab.url, urlRules);
            const matchedGroupIndex = matchedGroupId
              ? groupsState?.available.findIndex((g) => g.id === matchedGroupId) ?? -1
              : -1;
            const matchedGroup = matchedGroupIndex >= 0 ? groupsState?.available[matchedGroupIndex] : null;
            return matchedGroup ? (
              <DropdownMenuItem
                className="text-xs"
                onClick={() =>
                  moveTab({
                    fromGroupIndex: groupIndex,
                    fromWindowIndex: windowIndex,
                    fromTabIndex: tabIndex,
                    toGroupIndex: matchedGroupIndex,
                    copy: true
                  })
                }
              >
                <MoveRight className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <span>Auto-save to <strong>{matchedGroup.name}</strong></span>
              </DropdownMenuItem>
            ) : null;
          })()}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-xs"
            onClick={() => setNoteOpen(true)}
          >
            <StickyNote className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            {tab.note ? 'Edit note' : 'Add note'}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-xs"
            onClick={() => { setReminderOpen(true); setReminderNote(tab.reminder?.note ?? ''); }}
          >
            <Clock className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            {tab.reminder ? 'Edit reminder' : 'Remind me…'}
          </DropdownMenuItem>
          {tab.reminder && (
            <DropdownMenuItem
              className="text-xs text-destructive focus:text-destructive"
              onClick={() => clearTabReminder({ groupIndex, windowIndex, tabIndex })}
            >
              <Clock className="h-3.5 w-3.5 mr-2" />
              Clear reminder
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-xs"
            onClick={() => { setTitleValue(getDisplayTitle(tab)); setEditingTitle(true); }}
          >
            <Pencil className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
            Rename tab
          </DropdownMenuItem>
          {tab.customTitle && (
            <DropdownMenuItem
              className="text-xs"
              onClick={() => { void commitTitle(''); }}
            >
              <Pencil className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              Reset to original title
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-xs text-destructive focus:text-destructive"
            onClick={() => deleteTab({ groupIndex, windowIndex, tabIndex })}
          >
            <X className="h-3.5 w-3.5 mr-2" />
            {isNowOpen ? 'Close tab' : 'Remove tab'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Drag grip — ALWAYS present: a selection is dragged from any selected row's grip.
          In selection mode the checkbox sits right after it. */}
      {editingTitle ? (
        <span className="h-3 w-3 shrink-0" />
      ) : (
        <span
          className="opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground transition-opacity touch-none"
          draggable={!DND_POINTER_PROBE_ACTIVE}
          {...dragHandleProps}
          // AFTER the spread. dnd-kit's `attributes` DECLARE `tabIndex: 0`, and React
          // re-applies a declared prop on every render, so `useRovingRow`'s effect alone
          // can't hold -1 here. Attribute-only, hence C4-safe, and the grip stays
          // programmatically focusable (Right from the row; `dndFocus` after a keyboard drop).
          tabIndex={-1}
          // `aria-pressed` is left to dnd-kit (it flips at pickup): an attribute-only change,
          // even synchronously inside `dragstart`, does NOT abort the native drag — measured
          // with `gripAriaPressed` in e2e/repro/popupAbortWindow.repro.ts (spec C4).
          // Keep the "Drag to reorder" PREFIX: the DnD sensor/visuals select the grip by it.
          aria-label={`Drag to reorder tab: ${tabTitle}`}
          onMouseDown={onDragHandleMouseDown}
          onKeyDown={onDragHandleKeyDown}
        >
          <GripVertical className="h-3 w-3" />
        </span>
      )}
      {!editingTitle && showCheckbox && (
        <button
          type="button"
          className="shrink-0 flex items-center justify-center h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleCheckboxClick}
          onMouseDown={(e) => e.stopPropagation()}
          role="checkbox"
          aria-checked={isSelected}
          aria-label={`Select ${tabTitle}`}
        >
          {isSelected ? (
            <CheckSquare className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      <span className="relative h-3.5 w-3.5 shrink-0">
        <span className="rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-700 overflow-hidden flex items-center justify-center h-3.5 w-3.5">
          <img
            src={tab.favIconUrl || FALLBACK_FAVICON}
            alt=""
            className="h-3.5 w-3.5"
            onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
          />
        </span>
        {isStale && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-background"
            style={{ backgroundColor: groupColor || DEFAULT_GROUP_COLOR }}
            aria-label="Stale tab"
          />
        )}
      </span>

      {/* Title + hostname — two-column grid so the hostname column starts at a
          consistent x-offset across rows regardless of title length, instead
          of trailing directly after variable-width title text in a flex row. */}
      <div className="grid grid-cols-[12.5rem_minmax(0,1fr)] items-center gap-x-1.5 min-w-0 flex-1 overflow-hidden mr-2">
        {editingTitle ? (
          <div className="col-span-2 flex items-center gap-1 min-w-0">
            <input
              ref={titleInputRef}
              className="min-w-0 flex-1 text-xs leading-5 bg-background border border-primary/50 pl-1 focus:outline-none focus:ring-1 focus:ring-primary"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void commitTitle(titleValue); } }}
              onBlur={() => void commitTitle(titleValue)}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <button type="button" aria-label="Save" className="shrink-0 flex items-center justify-center h-4 w-4 rounded-sm bg-primary/20 hover:bg-primary/40 text-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => void commitTitle(titleValue)}><Check className="h-2.5 w-2.5" /></button>
            <button type="button" aria-label="Cancel" className="shrink-0 flex items-center justify-center h-4 w-4 rounded-sm bg-muted/60 hover:bg-muted text-muted-foreground" onMouseDown={(e) => e.preventDefault()} onClick={() => setEditingTitle(false)}><X className="h-2.5 w-2.5" /></button>
          </div>
        ) : (
          <>
            <TabPreview tab={tab}>
              <span
                className="block truncate min-w-0 text-xs leading-5 hover:underline"
                onClick={(e) => handleOpen(e)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {getDisplayTitle(tab) || tab.url}
              </span>
            </TabPreview>

            {getUrlDisplay(tab.url) ? (
              <span className="truncate shrink min-w-0 text-[10px] text-muted-foreground justify-self-start">
                {getUrlDisplay(tab.url)}
              </span>
            ) : (
              <span />
            )}
          </>
        )}
      </div>

      {/* Right-pinned indicator cluster — chromeGroup badge, renamed pill, note,
          reminder, and delete/lock all live here so adding the hostname column
          above never shoves them around per-row. */}
      {!editingTitle && (
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {tab.chromeGroup && (
            isNowOpen ? (
              <button
                type="button"
                className="relative z-10 text-[9px] px-1 py-0 max-w-[60px] truncate leading-4 border shrink-0 hover:brightness-110 cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
                style={{ backgroundColor: CHROME_GROUP_COLOR_MAP[tab.chromeGroup.color] ?? '#80868b', color: 'white', borderColor: 'transparent' }}
                onClick={(e) => { e.stopPropagation(); void handleReopenGroup(); }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={`Reopen Chrome group: ${tab.chromeGroup.name || 'unnamed'}`}
              >
                {tab.chromeGroup.name || ' '}
              </button>
            ) : (
              <span
                className="relative z-10 text-[9px] px-1 py-0 max-w-[60px] truncate leading-4 border shrink-0"
                style={{ backgroundColor: CHROME_GROUP_COLOR_MAP[tab.chromeGroup.color] ?? '#80868b', color: 'white', borderColor: 'transparent' }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={`Chrome group: ${tab.chromeGroup.name || 'unnamed'}`}
              >
                {tab.chromeGroup.name || ' '}
              </span>
            )
          )}

          {tab.customTitle && (
            <span
              className="relative z-10 text-[9px] px-1.5 py-0 leading-4 rounded-none shrink-0 flex items-center gap-0.5 whitespace-nowrap"
              style={{ backgroundColor: withAlpha(groupColor || DEFAULT_GROUP_COLOR, 0.18), color: groupColor || DEFAULT_GROUP_COLOR }}
              aria-label="Custom title"
            >
              <Pencil className="h-2 w-2" />
              renamed
            </span>
          )}

          {/* Note icon — only shown when tab has a note */}
          {tab.note && !isLocked && !selectionMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={(e) => { e.stopPropagation(); setNoteOpen(true); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Edit tab note"
                >
                  <StickyNote className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit note</TooltipContent>
            </Tooltip>
          )}

          {/* Clock icon — only shown when tab has a reminder */}
          {tab.reminder && !isLocked && !selectionMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="h-4 w-4 shrink-0 flex items-center justify-center hover:opacity-80 focus-visible:ring-1 focus-visible:ring-ring"
                  style={{ color: groupColor || DEFAULT_GROUP_COLOR }}
                  onClick={(e) => { e.stopPropagation(); setReminderOpen(true); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  aria-label="Edit tab reminder"
                >
                  <Clock className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">
                Reminder: {new Date(tab.reminder.fireAt).toLocaleString()}
                {tab.reminder.note ? ` — ${tab.reminder.note}` : ''}
              </TooltipContent>
            </Tooltip>
          )}

          {isLocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground/60">
                  <Lock className="h-3 w-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent>Upgrade to Pro to access this tab</TooltipContent>
            </Tooltip>
          ) : selectionMode ? <span className="h-4 w-4 shrink-0" /> : <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                aria-label={isNowOpen ? 'Close tab' : 'Remove tab'}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTab({ groupIndex, windowIndex, tabIndex });
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <X className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="bg-destructive text-destructive-foreground">{isNowOpen ? 'Close tab' : 'Remove tab'}</TooltipContent>
          </Tooltip>}
        </div>
      )}
    </div>

    {/* Inline reminder editor */}
    {reminderOpen && (
      <div
        ref={reminderContainerRef}
        className="mx-6 mb-1 flex flex-col gap-1.5 border border-amber-400/40 bg-card p-2 shadow-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-medium text-muted-foreground">Remind me in…</p>
        <div className="flex flex-wrap gap-1">
          {([
            { label: '30 min', ms: 30 * 60_000 },
            { label: '1 hour', ms: 60 * 60_000 },
            { label: '3 hours', ms: 3 * 60 * 60_000 },
            { label: 'Tomorrow', ms: 24 * 60 * 60_000 }
          ] as const).map(({ label, ms }) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              className="h-5 text-[10px] px-2"
              onClick={() => {
                setTabReminder({ groupIndex, windowIndex, tabIndex, fireAt: Date.now() + ms, note: reminderNote.trim() || undefined });
                setReminderOpen(false);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <input
          type="datetime-local"
          className="w-full border border-border bg-muted/50 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
          min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
          defaultValue={tab.reminder ? new Date(tab.reminder.fireAt).toISOString().slice(0, 16) : undefined}
          id={`reminder-dt-${tab.id}`}
          onKeyDown={(e) => { if (e.key === 'Escape') setReminderOpen(false); }}
        />
        <input
          type="text"
          maxLength={200}
          className="w-full border border-border bg-muted/50 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
          placeholder="Optional note…"
          value={reminderNote}
          onChange={(e) => setReminderNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setReminderOpen(false); }}
        />
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => setReminderOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            className="h-5 text-[10px] px-2 bg-amber-500 hover:bg-amber-600 text-white"
            onClick={() => {
              const dtEl = document.getElementById(`reminder-dt-${tab.id}`) as HTMLInputElement | null;
              if (!dtEl?.value) return;
              const fireAt = new Date(dtEl.value).getTime();
              if (isNaN(fireAt) || fireAt <= Date.now()) return;
              setTabReminder({ groupIndex, windowIndex, tabIndex, fireAt, note: reminderNote.trim() || undefined });
              setReminderOpen(false);
            }}
          >
            Set
          </Button>
        </div>
      </div>
    )}

    {/* Inline note editor */}
    {noteOpen && (
      <div
        ref={noteContainerRef}
        className="mx-6 mb-1 flex flex-col gap-1 border border-primary/40 bg-card p-2 shadow-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <textarea
          ref={textareaRef}
          rows={2}
          maxLength={500}
          className="w-full border border-border bg-muted/50 px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Add a note…"
          value={noteValue}
          onChange={(e) => setNoteValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setNoteOpen(false); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { commitNote(); }
          }}
          onBlur={handleNoteBlur}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{noteValue.length}/500</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => setNoteOpen(false)} onMouseDown={(e) => e.stopPropagation()}>Cancel</Button>
            <Button size="sm" className="h-5 text-[10px] px-2" onClick={commitNote} onMouseDown={(e) => e.stopPropagation()}>Save</Button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
