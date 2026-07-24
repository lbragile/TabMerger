import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,

  type Modifier
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupItem } from './GroupItem';
import type { GroupsState } from '@/lib/types';
import { useDndSensors, useGroupDndHandlers } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useAddGroup, useRestoreGroup, useDeleteGroup } from '@/hooks/useGroups';
import { useEntitlements, isOverFreeLimit } from '@/hooks/useEntitlements';
import { useSessions, useDeleteSession, useRestoreSession } from '@/hooks/useSessions';
import { pluralize } from '@/lib/utils';
import { getGroupTabCount } from '@/lib/utils';

// ponytail: no date-fns dep needed for this
function timeAgo(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface SidePanelProps {
  groupsState: GroupsState;
}

export function SidePanel({ groupsState }: SidePanelProps) {
  const sensors = useDndSensors();
  const { onDragEnd } = useGroupDndHandlers();
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);
  const { maxGroups } = useEntitlements();
  const { mutateAsync: addGroup } = useAddGroup();
  const { mutate: restoreGroup } = useRestoreGroup();
  const { mutate: deleteGroup } = useDeleteGroup();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [isDraggingGroup, setIsDraggingGroup] = useState(false);
  const { data: sessions = [] } = useSessions();
  const { mutate: deleteSession } = useDeleteSession();
  const { mutate: restoreSession, isPending: restoring } = useRestoreSession();

  // Sync DOM focus to sidebar group when navigating with arrow keys.
  // ponytail: only steal focus if the user is already keyboard-navigating the sidebar
  // (i.e., activeElement is another sidebar group), so window-panel tab focus is undisturbed.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.dataset.sidebarGroupIndex == null) return;
    const target = document.querySelector<HTMLElement>(`[data-sidebar-group-index="${activeGroupIndex}"]`);
    target?.focus({ preventScroll: false });
  }, [activeGroupIndex]);

  const raw = groupsState.available;

  // Split archived vs active (permanent is always active)
  const archivedGroups = raw
    .map((g, i) => ({ group: g, realIndex: i }))
    .filter(({ group }) => !group.permanent && group.archived);

  // Active display list: Now Open + non-archived saved groups, sorted starred first
  const activeRaw = raw.filter((g) => g.permanent || !g.archived);
  let savedDisplayIdx = 0;
  const available = [
    activeRaw[0], // Now Open is always first in activeRaw
    ...activeRaw.slice(1).filter((g) => g.starred),
    ...activeRaw.slice(1).filter((g) => !g.starred),
  ].map((g) => {
    const realIndex = raw.indexOf(g);
    // ponytail: all non-permanent groups count toward free-tier limit (archived included)
    const isLocked = !g.permanent && isFinite(maxGroups) && isOverFreeLimit(savedDisplayIdx, maxGroups);
    if (!g.permanent) savedDisplayIdx++;
    return { group: g, realIndex, isLocked };
  });
  const groupIds = available.map(({ realIndex }) => `group-${realIndex}`);

  const handleNewGroup = async () => {
    // All non-permanent groups count toward the limit (archived included — archiving doesn't free up slots)
    const activeCount = raw.filter((g) => !g.permanent).length;
    if (activeCount >= maxGroups) {
      toast.error(`Free plan allows up to ${maxGroups} groups.`, {
        action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
      });
      return;
    }
    const newIndex = raw.length;
    await addGroup({});
    setActiveGroupIndex(newIndex);
    setRenameTarget({ kind: 'group', groupIndex: newIndex });
  };

  // Restrict group reordering to vertical axis only
  const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

  return (
    <div
      className="flex flex-col h-full shrink-0 bg-zone-sidebar"
      style={{ width: 210, borderRight: '1px solid var(--zone-sidebar-border)' }}
    >
      {/* Groups list */}
      <ScrollArea className="flex-1">
        <div className="py-1.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragStart={() => setIsDraggingGroup(true)}
            onDragEnd={(e) => { setIsDraggingGroup(false); if (!selectionMode) onDragEnd(e); }}
            onDragCancel={() => setIsDraggingGroup(false)}
          >
            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {available.map(({ group, realIndex, isLocked }) => (
                <GroupItem
                  key={group.id}
                  group={group}
                  groupIndex={realIndex}
                  isActive={realIndex === activeGroupIndex}
                  isLocked={isLocked}
                  onClick={() => !selectionMode && setActiveGroupIndex(realIndex)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {!isDraggingGroup && (
            <div className="px-1.5 mt-2">
              <Button
                variant="outline"
                className="h-8 rounded-none px-3 text-xs w-full"
                onClick={handleNewGroup}
                disabled={selectionMode}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Group
              </Button>
            </div>
          )}

        </div>
      </ScrollArea>

      {/* Archived + Sessions — pinned above stats footer */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid var(--zone-sidebar-border)' }}
      >
        {archivedGroups.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              className="flex items-center gap-1 w-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors select-none"
              onClick={() => setArchivedOpen((o) => !o)}
            >
              {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              ARCHIVED ({archivedGroups.length})
            </button>
            {archivedOpen && (
              <div className="mt-0.5 max-h-28 overflow-y-auto">
                {archivedGroups.map(({ group, realIndex }) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-1.5 px-2 py-1.5 transition-colors"
                    style={{ borderLeft: `3px solid ${group.color}` }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-hover-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="block truncate text-[11px] text-muted-foreground">{group.name}</span>
                      <span className="block text-[9px] text-muted-foreground/50">{timeAgo(group.updatedAt)}</span>
                    </div>
                    <span
                      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
                      style={{ background: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-text-muted)' }}
                    >
                      <span>{group.windows.length}</span>
                      <span className="opacity-40">◆</span>
                      <span>{getGroupTabCount(group)}</span>
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => restoreGroup(realIndex)}
                          aria-label={`Restore ${group.name}`}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Restore group</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => deleteGroup(realIndex)}
                          aria-label={`Delete ${group.name}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Delete group</TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {sessions.length > 0 && (
          <div className={sessionsOpen ? 'mt-1.5' : 'mt-1.5 mb-1.5'}>
            <button
              type="button"
              className="flex items-center gap-1 w-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors select-none"
              onClick={() => setSessionsOpen((o) => !o)}
            >
              {sessionsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              SESSIONS ({sessions.length})
            </button>
            {sessionsOpen && (
              <div className="mt-0.5 max-h-28 overflow-y-auto">
                {sessions.map((session) => {
                  const winCount = session.groups.reduce((a, g) => a + g.windows.length, 0);
                  const tabCount = session.groups.reduce((a, g) => a + getGroupTabCount(g), 0);
                  return (
                    <div
                      key={session.id}
                      className="flex items-center gap-1.5 px-2 py-1.5 transition-colors"
                      style={{ borderLeft: `3px solid ${session.groups[0]?.color ?? 'var(--sidebar-text-muted)'}` }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--sidebar-hover-bg)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="block truncate text-[11px] text-muted-foreground">{session.name}</span>
                        <span className="block text-[9px] text-muted-foreground/50">{timeAgo(session.createdAt)}</span>
                      </div>
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-none shrink-0 whitespace-nowrap"
                        style={{ background: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-text-muted)' }}
                      >
                        <span>{session.groups.length}</span>
                        <span className="opacity-40">◆</span>
                        <span>{winCount}</span>
                        <span className="opacity-40">◆</span>
                        <span>{tabCount}</span>
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                            disabled={restoring}
                            aria-label={`Restore session: ${session.name}`}
                            onClick={() => {
                              if (window.confirm('This will close all open windows. Continue?')) {
                                restoreSession(session);
                              }
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Restore session</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => deleteSession(session.id)}
                            aria-label={`Delete session ${session.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Delete session</TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer — stats */}
      <div
        className="px-2 py-2 shrink-0"
        style={{ borderTop: '1px solid var(--zone-sidebar-border)' }}
      >
        {(() => {
          // ponytail: stats exclude archived groups
          const saved = raw.filter((g) => !g.permanent && !g.archived);
          const groupCount = saved.length;
          const winCount = saved.reduce((acc, g) => acc + g.windows.length, 0);
          const tabCount = saved.reduce((acc, g) => acc + g.windows.reduce((a, w) => a + w.tabs.length, 0), 0);
          return (
            <p className="text-[10px] text-center text-muted-foreground">
              {groupCount} {pluralize(groupCount, 'Group')} <span className="opacity-40">◆</span>{' '}
              {winCount} {pluralize(winCount, 'Window')} <span className="opacity-40">◆</span>{' '}
              {tabCount} {pluralize(tabCount, 'Tab')}
            </p>
          );
        })()}
        </div>
    </div>
  );
}
