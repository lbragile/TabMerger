import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, MoveRight, Square, CheckSquare, GripVertical, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TabPreview } from './TabPreview';
import type { Tab as TabType } from '@/lib/types';
import { useDeleteTab, useMoveTab, useGroups } from '@/hooks/useGroups';
import { useUIStore } from '@/stores/uiStore';
import { cn, fuzzyMatch } from '@/lib/utils';
import { getSetting } from '@/lib/localDb';
import { openTabInChromeGroup } from '@/lib/chromeGroups';

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
  searchFilter?: string;
  tagFilter?: string;
}

export function TabItem({ tab, groupIndex, windowIndex, tabIndex, searchFilter, tagFilter }: TabItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `tab-${groupIndex}-${windowIndex}-${tabIndex}`
  });
  const { mutate: deleteTab } = useDeleteTab();
  const { mutate: moveTab } = useMoveTab();
  const { data: groupsState } = useGroups();
  const [contextMenuOpen, setContextMenuOpen] = useState(false);

  const openModal = useUIStore((s) => s.openModal);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const selectedItems = useUIStore((s) => s.selectedItems);
  const toggleSelection = useUIStore((s) => s.toggleSelection);
  const enterSelectionMode = useUIStore((s) => s.enterSelectionMode);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const handleOpen = async (e?: React.MouseEvent) => {
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
    const newGroupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(newGroupId, {
      title: tab.chromeGroup.name,
      color: tab.chromeGroup.color as chrome.tabGroups.ColorEnum
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
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm hover:bg-accent/50 cursor-pointer',
        isDragging && 'opacity-50 bg-accent',
        searchFilter && !isHighlighted && 'opacity-30',
        tagFilter && !tagMatch && 'opacity-30',
        isSelected && 'bg-primary/10 ring-1 ring-primary/50'
      )}
      onClick={handleRowClick}
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
        <DropdownMenuContent className="w-48 text-xs" align="start">
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
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Drag handle — leftmost, hover-only */}
      <span
        className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing shrink-0 text-muted-foreground transition-opacity touch-none"
        {...attributes}
        {...listeners}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3" />
      </span>

      {/* Selection checkbox — appears in selection mode when type is 'tab' or uncommitted */}
      {showCheckbox && (
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
            <Square className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-700 overflow-hidden flex items-center justify-center">
        <img
          src={tab.favIconUrl || FALLBACK_FAVICON}
          alt=""
          className="h-3.5 w-3.5"
          onError={(e) => { e.currentTarget.src = FALLBACK_FAVICON; }}
        />
      </span>

      <TabPreview tab={tab}>
        <span
          className="flex-1 truncate text-xs leading-5 hover:underline"
          onClick={(e) => handleOpen(e)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {tab.title || tab.url}
        </span>
      </TabPreview>

      {tab.chromeGroup && (
        <span className="relative inline-flex items-center shrink-0 group/pill">
          <span
            className="text-[9px] px-1 py-0 rounded-full max-w-[60px] truncate text-white leading-4"
            style={{ backgroundColor: CHROME_GROUP_COLOR_MAP[tab.chromeGroup.color] ?? '#80868b' }}
          >
            {tab.chromeGroup.name || ' '}
          </span>
          {chrome.tabGroups && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 opacity-0 group-hover/pill:opacity-100 transition-opacity rounded hover:bg-accent p-0.5"
                  onClick={(e) => { e.stopPropagation(); void handleReopenGroup(); }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Reopen Chrome group</TooltipContent>
            </Tooltip>
          )}
        </span>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-opacity text-destructive/60 hover:text-destructive hover:bg-destructive/10"
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
      </Tooltip>
    </div>
  );
}
