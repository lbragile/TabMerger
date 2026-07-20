import { useState, useRef, useEffect, Fragment } from 'react';
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
  StickyNote
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

interface WindowProps {
  window: WindowType;
  groupIndex: number;
  windowIndex: number;
  siblingCount: number;
  tabIds: string[];
  isDraggingTab?: boolean;
  activeWindowIndex?: number | null;
  dragStartWinIndex?: number | null;
  insertState?: { tabId: string; position: 'before' | 'after' } | null;
  groupColor?: string;
  isBeingDragged?: boolean;
  searchFilter?: string;
  tagFilter?: string;
  tabOffset?: number;
  maxTabs?: number;
  staleThresholdMs?: number;
}

export function WindowItem({ window, groupIndex, windowIndex, siblingCount, tabIds, isDraggingTab, activeWindowIndex, dragStartWinIndex, insertState, groupColor, isBeingDragged, searchFilter, tagFilter, tabOffset = 0, maxTabs = Infinity, staleThresholdMs }: WindowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `window-${groupIndex}-${windowIndex}`
  });

  const [isEditing, setIsEditing] = useState(false);
  const [nameValue, setNameValue] = useState(window.name ?? 'Window');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) return;
    const id = setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 50);
    return () => clearTimeout(id);
  }, [isEditing]);

  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
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

  // Suppress window transform during tab drags (prevents windows jumping horizontally)
  const style = {
    transform: (isDraggingTab || isBeingDragged) ? undefined : CSS.Transform.toString(transform),
    transition: (isDraggingTab || isBeingDragged) ? undefined : transition,
    ...(window.starred ? { borderLeftColor: groupColor ?? 'hsl(var(--primary))' } : {})
  };

  // Cross-window drop target: active window that is NOT the drag source
  const isCrossWindowTarget =
    isDraggingTab && activeWindowIndex === windowIndex && windowIndex !== dragStartWinIndex;
  // ponytail: parse rgba(R,G,B,1) → rgba(R,G,B,0.4) for glow; fallback to transparent
  const glowStyle = isCrossWindowTarget && groupColor
    ? { boxShadow: `0 0 0 2px ${groupColor.replace(/,\s*[\d.]+\)$/, ', 0.4)')}` }
    : {};

  const handleRename = () => {
    if (nameValue.trim()) {
      updateWindowName({ groupIndex, windowIndex, name: nameValue.trim() });
    }
    setIsEditing(false);
  };

  const targetGroups =
    groupsState?.available.map((g, i) => ({ group: g, index: i })).filter(({ index }) => index !== groupIndex) ?? [];

  const committedType = selectedItems[0]?.type ?? null;
  const showCheckbox = selectionMode && (!committedType || committedType === 'window');
  const selectionId = `window-${groupIndex}-${windowIndex}`;
  const isSelected = selectedItems.some((s) => s.id === selectionId);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleSelection({ type: 'window', id: selectionId });
  };

  const handleHeaderClick = (e: React.MouseEvent) => {
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
      style={{ ...style, ...glowStyle }}
      className={cn(
        'rounded-md border border-border bg-card mb-2 p-1 transition-shadow min-w-0 overflow-hidden',
        isBeingDragged ? 'opacity-0' : isDragging && 'opacity-50 shadow-lg',
        window.starred && 'border-l-2',
        window.incognito && 'bg-muted/30',
        isSelected && 'ring-2 ring-primary/70'
      )}
    >
      {window.incognito && (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-t-md bg-primary/10 border-b border-primary/20 text-primary">
          <EyeOff className="h-2.5 w-2.5 shrink-0" />
          <span className="text-[10px] font-medium">Incognito</span>
        </div>
      )}

      {/* Window header */}
      <div
        className="group relative flex items-center gap-1.5 px-1.5 py-1 border-b border-border/50"
        onClick={handleHeaderClick}
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
            <DropdownMenuItem onClick={() => setNoteOpen(true)}>
              <StickyNote className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              {window.note ? 'Edit note' : 'Add note'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {showCheckbox ? (
          <button
            type="button"
            className="shrink-0 flex items-center justify-center h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleCheckboxClick}
            aria-label={isSelected ? 'Deselect window' : 'Select window'}
          >
            {isSelected ? (
              <CheckSquare className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
        ) : siblingCount > 1 ? (
          <span
            className="opacity-30 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground touch-none transition-opacity"
            {...(selectionMode ? {} : { ...attributes, ...listeners })}
            aria-label={selectionMode ? undefined : 'Drag to reorder window'}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}

        <div className="flex-1 min-w-0 relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn('block truncate text-xs font-medium cursor-default', isEditing && 'invisible')}
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
          {isEditing && (
            <input
              ref={renameInputRef}
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setIsEditing(false);
              }}
              className="absolute inset-0 w-full bg-transparent border-b border-primary outline-none text-xs px-0"
            />
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
                className="h-5 w-5 shrink-0 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring rounded"
                onClick={(e) => { e.stopPropagation(); setNoteOpen(true); }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label="Edit window note"
              >
                <StickyNote className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[200px] text-xs break-words">
              {window.note.length > 80 ? window.note.slice(0, 80) + '…' : window.note}
            </TooltipContent>
          </Tooltip>
        )}

        {!selectionMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-5 w-5 rounded', !window.starred && 'text-muted-foreground')}
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
          <DropdownMenu>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild disabled={selectionMode}>
                <Button variant="ghost" size="icon" className={selectionMode ? 'h-5 w-5 rounded invisible' : 'h-5 w-5 rounded text-muted-foreground'} aria-label="More window options">
                  <MoreHorizontal className="h-3 w-3 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <DropdownMenuContent align="end" className="text-xs max-h-80 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit3 className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                <div><div>Rename</div><div className="text-[10px] text-muted-foreground font-normal">Set a new name for this window</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleIncognito({ groupIndex, windowIndex })}>
                {window.incognito ? (
                  <>
                    <Shield className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                    <div><div>Remove incognito</div><div className="text-[10px] text-muted-foreground font-normal">Clear the incognito tag from this window</div></div>
                  </>
                ) : (
                  <>
                    <ShieldOff className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                    <div><div>Mark incognito</div><div className="text-[10px] text-muted-foreground font-normal">Tag this window as an incognito session</div></div>
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={window.tabs.length === 0}
                onClick={() => void openWindow(window)}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                <div><div>Open in browser</div><div className="text-[10px] text-muted-foreground font-normal">Open all tabs in a new browser window</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'title' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                <div><div>Sort tabs by title</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort tabs in this window</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => sortTabs({ groupIndex, by: 'url' })}>
                <SortAsc className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                <div><div>Sort tabs by URL</div><div className="text-[10px] text-muted-foreground font-normal">Alphabetically sort tabs by address</div></div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNoteOpen(true)}>
                <StickyNote className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
                <div><div>{window.note ? 'Edit note' : 'Add note'}</div><div className="text-[10px] text-muted-foreground font-normal">Attach a plain-text note to this window</div></div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                onClick={async () => {
                  const { confirmOnWindowClose } = await getSetting<{ confirmOnWindowClose: boolean }>(
                    'appSettings',
                    { confirmOnWindowClose: true }
                  );
                  if (confirmOnWindowClose) {
                    openModal('deleteWindow', { groupIndex, windowIndex, isNowOpen });
                  } else {
                    deleteWindow({ groupIndex, windowIndex });
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                <div>
                  <div>{isNowOpen ? 'Close window' : 'Remove window'}</div>
                  <div className="text-[10px] font-normal opacity-60">
                    {isNowOpen ? 'Close this browser window and its tabs' : 'Permanently remove this window and its tabs'}
                  </div>
                </div>
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
          className="mx-3 mt-1 mb-1 flex flex-col gap-1 rounded-md border border-primary/40 bg-card p-2 shadow-xs"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={noteTextareaRef}
            rows={2}
            maxLength={500}
            className="w-full rounded border border-border bg-muted/50 px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
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
      <div className={cn('py-0.5 px-3 overflow-y-auto', isCrossWindowTarget ? 'max-h-64' : 'max-h-52')}>
        <SortableContext items={tabIds} strategy={verticalListSortingStrategy}>
          {window.tabs.filter(Boolean).map((tab, tabIndex) => {
            const dndId = `tab-${tab.id}-${windowIndex}-${tabIndex}`;
            return (
              <Fragment key={dndId}>
                {isCrossWindowTarget && insertState?.tabId === dndId && insertState.position === 'before' && (
                  <div className="mx-1 my-0.5 h-0.5 rounded-sm" style={{ background: groupColor }} />
                )}
                <TabItem
                  tab={tab}
                  groupIndex={groupIndex}
                  windowIndex={windowIndex}
                  tabIndex={tabIndex}
                  siblingCount={window.tabs.length}
                  isDraggingTab={isDraggingTab}
                  activeWindowIndex={activeWindowIndex}
                  searchFilter={searchFilter}
                  tagFilter={tagFilter}
                  groupColor={groupColor}
                  isLocked={isFinite(maxTabs) && tabOffset + tabIndex >= maxTabs}
                  staleThresholdMs={staleThresholdMs}
                />
                {isCrossWindowTarget && insertState?.tabId === dndId && insertState.position === 'after' && (
                  <div className="mx-1 my-0.5 h-0.5 rounded-sm" style={{ background: groupColor }} />
                )}
              </Fragment>
            );
          })}
          {/* Insertion line at end when hovering empty window area */}
          {isCrossWindowTarget && insertState?.tabId === '__end__' && (
            <div className="mx-1 my-0.5 h-0.5 rounded-sm" style={{ background: groupColor }} />
          )}
        </SortableContext>
        {window.tabs.length === 0 && (
          <p className="px-3 py-1.5 text-xs text-muted-foreground italic">Empty window</p>
        )}
      </div>
    </div>
  );
}
