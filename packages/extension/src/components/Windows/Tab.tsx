import { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, MoveRight, CheckSquare2, CheckSquare, GripVertical, Lock, StickyNote, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TabPreview } from './TabPreview';
import type { Tab as TabType } from '@/lib/types';
import { useDeleteTab, useMoveTab, useGroups, useUpdateTabNote, useSetTabReminder, useClearTabReminder } from '@/hooks/useGroups';
import { useUrlRules, matchUrlToRule } from '@/hooks/useUrlRules';
import { useUIStore } from '@/stores/uiStore';
import { cn, fuzzyMatch } from '@/lib/utils';
import { getSetting } from '@/lib/localDb';
import { openTabInChromeGroup } from '@/lib/chromeGroups';
import { saveCustomTitle, getDisplayTitle, notifySavedTabTitle } from '@/lib/tabTitle';
import { useQueryClient } from '@tanstack/react-query';

const FALLBACK_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='2' fill='%23e5e7eb'/%3E%3Cpath d='M4 6h8M4 10h6' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E";

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
  tab: TabType;
  groupIndex: number;
  windowIndex: number;
  tabIndex: number;
  siblingCount: number;
  isDraggingTab?: boolean;
  activeWindowIndex?: number | null;
  searchFilter?: string;
  tagFilter?: string;
  groupColor?: string;
  isLocked?: boolean;
  staleThresholdMs?: number;
}

export function TabItem({ tab, groupIndex, windowIndex, tabIndex, siblingCount: _siblingCount, isDraggingTab, activeWindowIndex, searchFilter, tagFilter, groupColor: _groupColor, isLocked = false, staleThresholdMs }: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `tab-${tab.id}-${windowIndex}-${tabIndex}`
  });
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
  const noteContainerRef = useRef<HTMLDivElement>(null);
  const reminderContainerRef = useRef<HTMLDivElement>(null);

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
    await saveCustomTitle(tab.id, trimmed);
    void queryClient.invalidateQueries({ queryKey: ['groups'] });
    if (tab.chromeTabId != null && trimmed) {
      void notifySavedTabTitle({ browserTabId: tab.chromeTabId, customTitle: trimmed, tabId: tab.id });
    }
  };

  const handleNoteBlur = (e: React.FocusEvent) => {
    // Don't commit if focus moved to another element inside the note container
    if (noteContainerRef.current?.contains(e.relatedTarget as Node)) return;
    commitNote();
  };

  const openModal = useUIStore((s) => s.openModal);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const toggleSelection = useUIStore((s) => s.toggleSelection);
  const enterSelectionMode = useUIStore((s) => s.enterSelectionMode);

  // Suppress transforms on tabs in non-active windows so they don't animate during cross-window drag
  const suppressTransform = isDraggingTab && activeWindowIndex !== windowIndex;
  const style = {
    transform: suppressTransform ? undefined : CSS.Transform.toString(transform),
    transition: suppressTransform ? undefined : transition
  };

  const handleOpen = async (e?: React.MouseEvent) => {
    if (isLocked) return;
    // Skip opening the tab when Ctrl/Cmd is held — that gesture is for selection
    if (e && (e.ctrlKey || e.metaKey)) return;
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

  // Build list of groups this tab can be moved to (all except the current group)
  const targetGroups =
    groupsState?.available.map((g, i) => ({ group: g, index: i })).filter(({ index }) => index !== groupIndex) ?? [];

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

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggleSelection({ type: 'tab', id: selectionId });
  };

  const handleRowClick = (e: React.MouseEvent) => {
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
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center gap-1 min-w-0 rounded px-1.5 py-0.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isLocked ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent/50 cursor-pointer',
        isDragging && 'opacity-30 border border-dashed border-primary/40',
        searchFilter && !isHighlighted && 'opacity-30',
        tagFilter && !tagMatch && 'opacity-30',
        isSelected && 'bg-primary/10 ring-1 ring-primary/50'
      )}
      tabIndex={0}
      role="listitem"
      aria-label={tab.title || tab.url}
      data-group-index={groupIndex}
      data-window-index={windowIndex}
      data-tab-index={tabIndex}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isLocked) {
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
            className="text-xs text-destructive focus:text-destructive"
            onClick={async () => {
              const { confirmOnTabClose } = await getSetting<{ confirmOnTabClose: boolean }>(
                'appSettings',
                { confirmOnTabClose: false }
              );
              if (confirmOnTabClose) {
                openModal('deleteTab', { groupIndex, windowIndex, tabIndex, isNowOpen });
              } else {
                deleteTab({ groupIndex, windowIndex, tabIndex });
              }
            }}
          >
            <X className="h-3.5 w-3.5 mr-2" />
            {isNowOpen ? 'Close tab' : 'Remove tab'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Single slot: checkbox in selection mode, drag handle otherwise */}
      {showCheckbox ? (
        <button
          type="button"
          className="shrink-0 flex items-center justify-center h-4 w-4 text-muted-foreground hover:text-foreground transition-colors"
          onClick={handleCheckboxClick}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={isSelected ? 'Deselect tab' : 'Select tab'}
        >
          {isSelected ? (
            <CheckSquare className="h-3.5 w-3.5 text-primary" />
          ) : (
            <CheckSquare2 className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      ) : (
        <span
          className="opacity-30 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground transition-opacity touch-none"
          {...(selectionMode ? {} : { ...attributes, ...listeners })}
          aria-label={selectionMode ? undefined : 'Drag to reorder tab'}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3 w-3" />
        </span>
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
          <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 ring-1 ring-background" aria-label="Stale tab" />
        )}
      </span>

      {/* Title + tag — compact, tag sits right after text */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
        {editingTitle ? (
          <input
            autoFocus
            className="block min-w-0 w-full text-xs leading-5 bg-background border border-primary/50 rounded px-1 focus:outline-none focus:ring-1 focus:ring-primary"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={(e) => { void commitTitle(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { void commitTitle(titleValue); }
              if (e.key === 'Escape') { setEditingTitle(false); }
            }}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
        <TabPreview tab={tab} isLive={isNowOpen}>
          <span
            className="block truncate overflow-hidden min-w-0 w-full text-xs leading-5 hover:underline"
            onClick={(e) => handleOpen(e)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setTitleValue(getDisplayTitle(tab));
              setEditingTitle(true);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {getDisplayTitle(tab) || tab.url}
          </span>
        </TabPreview>
        )}

        {tab.chromeGroup && (
          isNowOpen ? (
            <button
              type="button"
              className="relative z-10 text-[9px] px-1 py-0 rounded-full max-w-[60px] truncate leading-4 border shrink-0 hover:brightness-110 cursor-pointer focus-visible:ring-1 focus-visible:ring-ring"
              style={{ backgroundColor: CHROME_GROUP_COLOR_MAP[tab.chromeGroup.color] ?? '#80868b', color: 'white', borderColor: 'transparent' }}
              onClick={(e) => { e.stopPropagation(); void handleReopenGroup(); }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`Reopen Chrome group: ${tab.chromeGroup.name || 'unnamed'}`}
            >
              {tab.chromeGroup.name || ' '}
            </button>
          ) : (
            <span
              className="relative z-10 text-[9px] px-1 py-0 rounded-full max-w-[60px] truncate leading-4 border shrink-0"
              style={{ backgroundColor: CHROME_GROUP_COLOR_MAP[tab.chromeGroup.color] ?? '#80868b', color: 'white', borderColor: 'transparent' }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`Chrome group: ${tab.chromeGroup.name || 'unnamed'}`}
            >
              {tab.chromeGroup.name || ' '}
            </span>
          )
        )}
      </div>

      {/* Note icon — only shown when tab has a note */}
      {tab.note && !isLocked && !selectionMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring rounded"
              onClick={(e) => { e.stopPropagation(); setNoteOpen(true); }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Edit tab note"
            >
              <StickyNote className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[200px] text-xs break-words">
            {tab.note.length > 80 ? tab.note.slice(0, 80) + '…' : tab.note}
          </TooltipContent>
        </Tooltip>
      )}

      {/* Clock icon — only shown when tab has a reminder */}
      {tab.reminder && !isLocked && !selectionMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-4 w-4 shrink-0 flex items-center justify-center text-amber-500/70 hover:text-amber-500 focus-visible:ring-1 focus-visible:ring-ring rounded"
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
            className="h-4 w-4 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-opacity text-destructive/60 hover:text-destructive hover:bg-destructive/10"
            aria-label={isNowOpen ? 'Close tab' : 'Remove tab'}
            onClick={async (e) => {
              e.stopPropagation();
              const { confirmOnTabClose } = await getSetting<{ confirmOnTabClose: boolean }>(
                'appSettings',
                { confirmOnTabClose: false }
              );
              if (confirmOnTabClose) {
                openModal('deleteTab', { groupIndex, windowIndex, tabIndex, isNowOpen });
              } else {
                deleteTab({ groupIndex, windowIndex, tabIndex });
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <X className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent className="bg-destructive text-destructive-foreground">{isNowOpen ? 'Close tab' : 'Remove tab'}</TooltipContent>
      </Tooltip>}
    </div>

    {/* Inline reminder editor */}
    {reminderOpen && (
      <div
        ref={reminderContainerRef}
        className="mx-6 mb-1 flex flex-col gap-1.5 rounded-md border border-amber-400/40 bg-card p-2 shadow-xs"
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
          className="w-full rounded border border-border bg-muted/50 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
          min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
          defaultValue={tab.reminder ? new Date(tab.reminder.fireAt).toISOString().slice(0, 16) : undefined}
          id={`reminder-dt-${tab.id}`}
          onKeyDown={(e) => { if (e.key === 'Escape') setReminderOpen(false); }}
        />
        <input
          type="text"
          maxLength={200}
          className="w-full rounded border border-border bg-muted/50 px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
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
        className="mx-6 mb-1 flex flex-col gap-1 rounded-md border border-primary/40 bg-card p-2 shadow-xs"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <textarea
          ref={textareaRef}
          rows={2}
          maxLength={500}
          className="w-full rounded border border-border bg-muted/50 px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
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
