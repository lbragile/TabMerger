import { useState, useRef, useEffect } from 'react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Star,
  EyeOff,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  Edit3,
  ShieldOff,
  Shield,
  GripVertical,
  MoveRight,
  Square,
  CheckSquare,
  SortAsc,
  StickyNote,
  Check,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { TabItem } from './Tab';
import { CreateGroupMenuItem } from './CreateGroupMenuItem';
import { useRovingRow } from '@/hooks/useRovingRow';
import { useCloseOnOverlayDismiss } from '@/hooks/useCloseOnOverlayDismiss';
import type { Window as WindowType } from '@/lib/types';
import {
  useDeleteWindow,
  useUpdateWindowName,
  useUpdateWindowNote,
  useToggleWindowStarred,
  useToggleWindowIncognito,
  useMoveWindow,
  useGroups,
  useSortTabs
} from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { cn, pluralize } from '@/lib/utils';
import { getSetting } from '@/lib/localDb';
import { useOpenWindow } from '@/hooks/useOpenWindow';
import { useDndContext } from '@/components/dnd/DndProvider';
import { dndListStyle, gapGrowthFor, gapTransformFor } from '@/lib/dndInsertion';
import { DND_POINTER_PROBE_ACTIVE } from '@/lib/dndPointerProbe';
import { selectionRange } from '@/lib/selectionRange';
import { isDndDragLive } from '@/lib/dndMultiDrag';

interface WindowProps {
  /** parent group's model id — window sortable id is `${groupId}::w${windowIndex}` */
  groupId?: string;
  window: WindowType;
  groupIndex: number;
  windowIndex: number;
  /** Windows in this group. No longer gates the drag grip (a lone window is draggable too). */
  siblingCount: number;
  tabIds: string[];
  groupColor?: string;
  isBeingDragged?: boolean;
  searchFilter?: string;
  tagFilter?: string;
  tabOffset?: number;
  maxTabs?: number;
  staleThresholdMs?: number;
}

export function WindowItem({ groupId, window, groupIndex, windowIndex, siblingCount: _siblingCount, tabIds, groupColor, searchFilter, tagFilter, tabOffset = 0, maxTabs = Infinity, staleThresholdMs }: WindowProps) {
  const sortableId = `${groupId}::w${windowIndex}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    // `starred` is the row's ZONE (starred windows are pinned to the top of the group), so
    // the collision layer can clamp the insertion gap into it — see `@/lib/dndInsertion`.
    data: { type: 'window', groupId, starred: !!window.starred }
  });
  const { gap, active: dndActive } = useDndContext();
  const keyboardDrag = dndActive?.keyboard === true;
  const windowTitle = window.name ?? `Window ${windowIndex + 1}`;
  // The header row is ONE Tab stop (a11y M3): `role="toolbar"` + `tabIndex=0` on the
  // container, `useRovingRow` pinning every control to -1 and walking them with
  // Left/Right/Home/End. `toolbar` is chosen over a bare `group` precisely because it is
  // the ARIA pattern screen readers already describe as arrow-navigable, so the roving
  // affordance is announced without an extra `aria-describedby` on every row.
  const headerRoving = useRovingRow<HTMLDivElement>();

  const [isEditing, setIsEditing] = useState(false);
  const [nameValue, setNameValue] = useState(window.name ?? 'Window');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    const id = setTimeout(() => {
      const el = renameInputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }, 50);
    return () => clearTimeout(id);
  }, [isEditing]);

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  // Starting a multi-select must not leave this window's menus / note editor floating
  // over the rows the user is about to tick (see `useCloseOnOverlayDismiss`).
  useCloseOnOverlayDismiss(() => {
    setContextMenuOpen(false);
    setMoreMenuOpen(false);
    setNoteOpen(false);
  });
  const [noteValue, setNoteValue] = useState('');
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const noteContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (noteOpen) {
      setNoteValue(window.note ?? '');
      setTimeout(() => noteTextareaRef.current?.focus(), 0);
    }
  }, [noteOpen, window.note]);

  const openWindow = useOpenWindow();
  const { mutate: deleteWindow } = useDeleteWindow();
  const { mutate: updateWindowName } = useUpdateWindowName();
  const { mutate: updateWindowNote } = useUpdateWindowNote();
  const { mutate: toggleStarred } = useToggleWindowStarred();
  const { mutate: toggleIncognito } = useToggleWindowIncognito();
  const { mutate: moveWindow } = useMoveWindow();
  const { mutate: sortTabs } = useSortTabs();
  const { data: groupsState } = useGroups();
  const isNowOpen = groupsState?.available[groupIndex]?.permanent ?? false;

  const openModal = useUIStore((s) => s.openModal);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const toggleSelection = useUIStore((s) => s.toggleSelection);
  const enterSelectionMode = useUIStore((s) => s.enterSelectionMode);
  const selectRange = useUIStore((s) => s.selectRange);
  const selectionAnchor = useUIStore((s) => s.selectionAnchor);

  // `Html5DragSensor` runs a native HTML5 drag; in the MV3 popup Chrome aborts it
  // the moment the dragged window (an ancestor of its grip) mutates. So: no live
  // `transform` on the dragged window, a STABLE `transition` string (dnd-kit's
  // value flips mid-drag), and no `isDragging`/`isBeingDragged` class toggle
  // (see className). The ghost card is the drag affordance.
  // While a native drag has collapsed its source row, siblings render the
  // insertion-gap transform (`gap`) instead of the strategy transform.
  const gapTransform = gapTransformFor(gap, sortableId);
  // Keyboard drags (no native session) DO render the live transform — see Tab.tsx.
  const style = {
    transform: isDragging && !keyboardDrag ? undefined : gapTransform !== null ? gapTransform : CSS.Transform.toString(transform),
    transition: 'transform 200ms ease',
    ...(window.starred ? { borderLeftColor: groupColor ?? 'hsl(var(--primary))' } : {})
  };

  const handleRename = () => {
    if (nameValue.trim()) {
      updateWindowName({ groupIndex, windowIndex, name: nameValue.trim() });
    }
    setIsEditing(false);
  };

  const targetGroups =
    groupsState?.available
      .map((g, i) => ({ group: g, index: i }))
      .filter(({ group, index }) => index !== groupIndex && !group.archived) ?? [];

  const committedType = selectedItems[0]?.type ?? null;
  const showCheckbox = selectionMode && (!committedType || committedType === 'window');
  const selectionId = `window-${groupIndex}-${windowIndex}`;
  const isSelected = selectedItems.some((s) => s.id === selectionId);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Shift on the checkbox (click, or Shift+Space with it focused) extends a range.
    if (e.shiftKey) {
      const item = { type: 'window' as const, id: selectionId };
      selectRange(item, selectionRange(groupsState, selectionAnchor, item));
      return;
    }
    toggleSelection({ type: 'window', id: selectionId });
  };

  const handleHeaderClick = (e: React.MouseEvent) => {
    // Shift+click extends the selection from the anchor to this window (same group)
    if (e.shiftKey) {
      e.stopPropagation();
      const item = { type: 'window' as const, id: selectionId };
      selectRange(item, selectionRange(groupsState, selectionAnchor, item));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      enterSelectionMode();
      toggleSelection({ type: 'window', id: selectionId });
    }
  };

  const commitWindowNote = () => {
    updateWindowNote({ groupIndex, windowIndex, note: noteValue.trim() });
    setNoteOpen(false);
  };

  const handleWindowNoteBlur = (e: React.FocusEvent) => {
    if (noteContainerRef.current?.contains(e.relatedTarget as Node)) return;
    commitWindowNote();
  };

  return (
    <div
      ref={setNodeRef}
      data-window-index={windowIndex}
      data-tm-dnd-id={sortableId}
      style={style}
      className={cn(
        'border border-border bg-card mb-2 p-1 transition-shadow min-w-0 overflow-hidden',
        // No `isDragging` / `isBeingDragged` class toggle — mutating the dragged
        // window's className mid-drag aborts the native HTML5 drag in the MV3
        // popup. The ghost card is the drag affordance.
        window.starred && 'border-l-2',
        window.incognito && 'bg-muted/30',
        isSelected && 'ring-2 ring-primary',
        // KEYBOARD drags only (C4 doesn't apply): lift the dragged window, mark selected companions.
        isDragging && keyboardDrag && 'relative z-10 shadow-lg ring-2 ring-ring',
        keyboardDrag &&
          !isDragging &&
          dndActive?.selectionIds?.includes(sortableId) &&
          'outline-dashed outline-1 -outline-offset-1 outline-foreground'
      )}
    >
      {window.incognito && (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 border-b border-primary/20 text-primary">
          <EyeOff className="h-2.5 w-2.5 shrink-0" />
          <span className="text-[10px] font-medium">Incognito</span>
        </div>
      )}

      {/* Window header */}
      <div
        ref={headerRoving.ref}
        className="group relative flex items-center gap-1.5 px-1.5 py-1 border-b border-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        // Static (never toggled): keyboard-drop focus lands on the header itself when the
        // window has no grip (a group's only window) — see `dndFocus`.
        data-window-header=""
        // ONE Tab stop for the whole header; Left/Right/Home/End walk grip → checkbox →
        // note → star → "More". `toolbar` is the ARIA pattern for exactly that, and it
        // announces the affordance, which a bare focusable `div` would not.
        tabIndex={0}
        role="toolbar"
        aria-label={`${windowTitle} controls`}
        onKeyDown={(e) => {
          // Inert mid-drag, so dnd-kit still receives the arrows (spec C13).
          headerRoving.onKeyDown(e);
        }}
        onClick={handleHeaderClick}
        // Shift+click must not extend the browser's TEXT selection.
        onMouseDown={(e) => {
          if (e.shiftKey) e.preventDefault();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenuOpen(true);
        }}
      >
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
                      moveWindow({ fromGroupIndex: groupIndex, windowIndex, toGroupIndex: index })
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
                  onCreated={(index) => moveWindow({ fromGroupIndex: groupIndex, windowIndex, toGroupIndex: index })}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onClick={() => setNoteOpen(true)}>
              <StickyNote className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              {window.note ? 'Edit note' : 'Add note'}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={() => setIsEditing(true)}>
              <Edit3 className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              Rename window
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
              onClick={async () => {
                const { confirmOnDelete } = await getSetting<{ confirmOnDelete: boolean }>(
                  'appSettings',
                  { confirmOnDelete: false }
                );
                if (confirmOnDelete) {
                  openModal('deleteWindow', { groupIndex, windowIndex, isNowOpen });
                } else {
                  deleteWindow({ groupIndex, windowIndex });
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              {isNowOpen ? 'Close window' : 'Remove window'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Drag grip stays live in selection mode (dragging a selected window drags the
            selection); the checkbox sits right after it.

            Rendered even when this is the group's ONLY window: moving that window to
            another group is a legitimate move (the source group is simply left empty —
            it is never auto-deleted), and gating this on `siblingCount > 1` made that
            window undraggable and unreachable by keyboard drag. */}
        <span
          className="opacity-30 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground touch-none transition-opacity"
          // Native onDragStart activator (see useDnd.ts + dndHtml5Sensor) needs
          // `draggable` set — dnd-kit only spreads `listeners`, never the attr.
          draggable={!DND_POINTER_PROBE_ACTIVE}
          {...attributes}
          {...listeners}
          // AFTER the spread: dnd-kit's `attributes` DECLARE `tabIndex: 0` and React
          // re-applies a declared prop every render, so `useRovingRow`'s effect alone
          // cannot hold the grip out of the Tab order (same fix as Tab.tsx's grip).
          tabIndex={-1}
          // AFTER the spread, delegating: Shift+Space range-selects (dnd-kit's activator
          // ignores modifiers and would pick the window up); every other key reaches dnd-kit.
          onKeyDown={(e: React.KeyboardEvent) => {
            if ((e.key === ' ' || e.code === 'Space') && e.shiftKey && !isDndDragLive()) {
              e.preventDefault();
              e.stopPropagation();
              const item = { type: 'window' as const, id: selectionId };
              selectRange(item, selectionRange(groupsState, selectionAnchor, item));
              return;
            }
            (listeners as { onKeyDown?: (e: React.KeyboardEvent) => void } | undefined)?.onKeyDown?.(e);
          }}
          // `aria-pressed` is left to dnd-kit: attribute-only changes survive a native
          // drag even synchronously in `dragstart` (popupAbortWindow `gripAriaPressed`, C4).
          // Keep the "Drag to reorder" PREFIX: the DnD sensor/visuals select the grip by it.
          aria-label={`Drag to reorder window: ${windowTitle}`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
        {showCheckbox && (
          <button
            type="button"
            className="shrink-0 flex items-center justify-center h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleCheckboxClick}
            role="checkbox"
            aria-checked={isSelected}
            aria-label={`Select ${windowTitle}`}
          >
            {isSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1 w-full">
              <input
                ref={renameInputRef}
                size={1}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                onBlur={handleRename}
                className="min-w-0 flex-1 bg-transparent border-b border-primary outline-none text-xs px-0"
              />
              <button type="button" aria-label="Save" className="shrink-0 flex items-center justify-center h-4 w-4 rounded-sm bg-primary/20 hover:bg-primary/40 text-primary" onMouseDown={(e) => e.preventDefault()} onClick={handleRename}><Check className="h-2.5 w-2.5" /></button>
              <button type="button" aria-label="Cancel" className="shrink-0 flex items-center justify-center h-4 w-4 rounded-sm bg-muted/60 hover:bg-muted text-muted-foreground" onMouseDown={(e) => e.preventDefault()} onClick={() => setIsEditing(false)}><X className="h-2.5 w-2.5" /></button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="block truncate text-xs font-medium cursor-default"
                  onDoubleClick={() => setIsEditing(true)}
                >
                  {(window.name ?? 'Window').length > 20
                    ? `${(window.name ?? 'Window').slice(0, 20)}…`
                    : (window.name ?? 'Window')}
                </span>
              </TooltipTrigger>
              {(window.name ?? 'Window').length > 20 && (
                <TooltipContent side="top">{window.name ?? 'Window'}</TooltipContent>
              )}
            </Tooltip>
          )}
        </div>

        <span className="text-[10px] text-muted-foreground">
          {window.tabs.length} {pluralize(window.tabs.length, 'tab')}
        </span>

        {window.note && !selectionMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="h-5 w-5 shrink-0 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                onClick={(e) => { e.stopPropagation(); setNoteOpen(true); }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Edit window note"
              >
                <StickyNote className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit note</TooltipContent>
          </Tooltip>
        )}

        {!selectionMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-5 w-5 rounded-none', !window.starred && 'text-muted-foreground')}
                style={window.starred ? { color: groupColor ?? 'var(--star-active)' } : undefined}
                onClick={() => toggleStarred({ groupIndex, windowIndex })}
                aria-label={window.starred ? 'Unstar window' : 'Star window'}
              >
                <Star className="h-3 w-3" fill={window.starred ? 'currentColor' : 'none'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{window.starred ? 'Unstar window' : 'Star window'}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          {/* Controlled so `useCloseOnOverlayDismiss` can shut it when a multi-select starts. */}
          <DropdownMenu open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild disabled={selectionMode}>
                <Button variant="ghost" size="icon" className={selectionMode ? 'h-5 w-5 invisible' : 'h-5 w-5 text-muted-foreground'} aria-label="More window options">
                  <MoreHorizontal className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent align="end" className="w-48 text-xs" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem className="text-xs" onClick={() => setIsEditing(true)}>
                <Edit3 className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => toggleIncognito({ groupIndex, windowIndex })}>
                {window.incognito ? (
                  <><Shield className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />Remove incognito</>
                ) : (
                  <><ShieldOff className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />Mark incognito</>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" disabled={window.tabs.length === 0} onClick={() => void openWindow(window)}>
                <ExternalLink className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                Open in browser
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => sortTabs({ groupIndex, by: 'title' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                Sort by title
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => sortTabs({ groupIndex, by: 'url' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                Sort by URL
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs" onClick={() => setNoteOpen(true)}>
                <StickyNote className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                {window.note ? 'Edit note' : 'Add note'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                onClick={async () => {
                  const { confirmOnDelete } = await getSetting<{ confirmOnDelete: boolean }>(
                    'appSettings',
                    { confirmOnDelete: false }
                  );
                  if (confirmOnDelete) {
                    openModal('deleteWindow', { groupIndex, windowIndex, isNowOpen });
                  } else {
                    deleteWindow({ groupIndex, windowIndex });
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                {isNowOpen ? 'Close window' : 'Remove window'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!selectionMode && <TooltipContent>More options</TooltipContent>}
        </Tooltip>
      </div>

      {/* Window inline note editor */}
      {noteOpen && (
        <div
          ref={noteContainerRef}
          className="mx-3 mt-1 mb-1 flex flex-col gap-1 border border-primary/40 bg-card p-2 shadow-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={noteTextareaRef}
            rows={2}
            maxLength={500}
            className="w-full border border-border bg-muted/50 px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Add a note…"
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setNoteOpen(false); }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { commitWindowNote(); }
            }}
            onBlur={handleWindowNoteBlur}
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{noteValue.length}/500</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => setNoteOpen(false)} onMouseDown={(e) => e.stopPropagation()}>Cancel</Button>
              <Button size="sm" className="h-5 text-[10px] px-2" onClick={commitWindowNote} onMouseDown={(e) => e.stopPropagation()}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs list */}
      <div
        role="list"
        data-tm-dnd-list=""
        className="py-0.5 px-3 overflow-y-auto max-h-52"
        style={dndListStyle(gapGrowthFor(gap, sortableId), '0.125rem')}
      >
        <SortableContext items={tabIds} strategy={verticalListSortingStrategy}>
          {window.tabs.filter(Boolean).map((tab, tabIndex) => (
            <TabItem
              key={`${groupId}::w${windowIndex}::t${tabIndex}`}
              groupId={groupId}
              tab={tab}
              groupIndex={groupIndex}
              windowIndex={windowIndex}
              tabIndex={tabIndex}
              siblingCount={window.tabs.length}
              searchFilter={searchFilter}
              tagFilter={tagFilter}
              groupColor={groupColor}
              isLocked={isFinite(maxTabs) && tabOffset + tabIndex >= maxTabs}
              staleThresholdMs={staleThresholdMs}
            />
          ))}
        </SortableContext>
        {window.tabs.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-muted-foreground italic">Empty window</p>
        )}
      </div>
    </div>
  );
}
