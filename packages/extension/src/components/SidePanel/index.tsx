import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,

  type Modifier
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, ChevronDown, ChevronRight, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupItem } from './GroupItem';
import type { GroupsState } from '@/lib/types';
import { useDndSensors, useGroupDndHandlers } from '@/hooks/useDnd';
import { useUIStore } from '@/stores/uiStore';
import { useAddGroup, useRestoreGroup } from '@/hooks/useGroups';
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
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
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
        <div className="p-1.5">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={selectionMode ? () => {} : onDragEnd}
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

          <div className="flex justify-center">
          <Button
            variant="outline"
            className="h-8 rounded-md px-3 mt-2 text-xs"
            onClick={handleNewGroup}
            disabled={selectionMode}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Group
          </Button>
          </div>

          {/* Archived section */}
          {archivedGroups.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                className="flex items-center gap-1 w-full px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors select-none"
                onClick={() => setArchivedOpen((o) => !o)}
              >
                {archivedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Archived ({archivedGroups.length})
              </button>
              {archivedOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {archivedGroups.map(({ group, realIndex }) => (
                    <div
                      key={group.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex-1 min-w-0 truncate text-[11px] text-muted-foreground">
                            {group.name.length > 10 ? `${group.name.slice(0, 10)}…` : group.name}
                          </span>
                        </TooltipTrigger>
                        {group.name.length > 10 && (
                          <TooltipContent side="top">{group.name}</TooltipContent>
                        )}
                      </Tooltip>
                      <span
                        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md shrink-0 whitespace-nowrap"
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Sessions section */}
          {sessions.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                className="flex items-center gap-1 w-full px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors select-none"
                onClick={() => setSessionsOpen((o) => !o)}
              >
                {sessionsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Sessions ({sessions.length})
              </button>
              {sessionsOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.05)' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-[11px] text-foreground">
                          {session.name.length > 14 ? `${session.name.slice(0, 14)}…` : session.name}
                        </p>
                        <p className="text-[9px] text-muted-foreground/60">{timeAgo(session.createdAt)}</p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-[10px] text-primary hover:underline px-1"
                        disabled={restoring}
                        aria-label={`Restore session: ${session.name}`}
                        onClick={() => {
                          if (window.confirm('This will close all open windows. Continue?')) {
                            restoreSession(session);
                          }
                        }}
                      >
                        Restore
                      </button>
                      <button
                        type="button"
                        className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        onClick={() => deleteSession(session.id)}
                        aria-label={`Delete session ${session.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

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
              {groupCount} {pluralize(groupCount, 'Group')} &middot;{' '}
              {winCount} {pluralize(winCount, 'Window')} &middot;{' '}
              {tabCount} {pluralize(tabCount, 'Tab')}
            </p>
          );
        })()}
        </div>
    </div>
  );
}
