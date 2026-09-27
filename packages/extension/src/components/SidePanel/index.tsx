import { useCallback, useEffect, useState } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Plus, ChevronDown, ChevronRight, RotateCcw, Trash2, BookmarkPlus } from 'lucide-react';
import { toast } from '@/lib/toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GroupItem } from './GroupItem';
import type { GroupsState } from '@/lib/types';
import { useDndContext } from '@/components/dnd/DndProvider';
import { dndListStyle, gapGrowthFor } from '@/lib/dndInsertion';
import { NEW_GROUP_ID, setNewGroupZoneGate } from '@/hooks/useDndHandlers';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useAddGroup, useRestoreGroup, useDeleteGroup } from '@/hooks/useGroups';
import { useEntitlements, isOverFreeLimit } from '@/hooks/useEntitlements';
import { useSessions, useDeleteSession, useRestoreSession, useSaveSession } from '@/hooks/useSessions';
import { pluralize } from '@/lib/utils';
import { getGroupTabCount } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { getSidebarDisplayOrder } from '@/lib/sidebarOrder';

/**
 * Shared shell for the Archived / Sessions sidebar sections: a disclosure header row
 * (chevron + label + count), an optional right-aligned action button as a SIBLING of the
 * toggle (never nested — nested interactive elements are invalid HTML and break both a11y
 * and click handling), and a collapsible body that shows `emptyLabel` when there is
 * nothing to list. Both sections always render — only the body is gated on `open`.
 */
function SidebarSection({
  label,
  count,
  open,
  onToggle,
  isEmpty,
  emptyLabel,
  action,
  className,
  children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  isEmpty: boolean;
  emptyLabel: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          className="flex items-center gap-1 flex-1 min-w-0 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors select-none"
          onClick={onToggle}
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="truncate">{label} ({count})</span>
        </button>
        {action}
      </div>
      {open && (
        isEmpty ? (
          <p className="mt-0.5 px-2 py-1.5 text-[11px] text-muted-foreground/60">{emptyLabel}</p>
        ) : (
          <div className="mt-0.5 max-h-28 overflow-y-auto">{children}</div>
        )
      )}
    </div>
  );
}

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

/**
 * Sidebar "drop here for a new group" zone — the mirror of `NewWindowDropZone` in the
 * windows panel. Visible while a TAB or WINDOW drag is live; dropping here creates a
 * fresh group holding the dragged item(s) (`moveToNewGroup` in `@/lib/dndMove`), and a
 * whole multi-selection lands in ONE new group.
 *
 * Constraints it exists to satisfy (spec C4):
 *  - ALWAYS mounted — unmounting a child of a group grip's ancestor aborts the native
 *    HTML5 drag; only `invisible` / `pointer-events-none` are toggled;
 *  - absolutely positioned, so nothing in the sidebar changes height mid-drag;
 *  - rendered AFTER the group `SortableContext`, so it is never an ancestor of any grip.
 *
 * At the free-tier group cap it is HIDDEN (user decision, 2026-09-18): `active` is false,
 * so it renders exactly as it does when no drag is running — `invisible`,
 * `pointer-events-none`, `aria-hidden`, droppable disabled — and NO upgrade toast fires,
 * because there is nothing to drop on. It is still MOUNTED, so C4 holds. The cap is
 * published through `setNewGroupZoneGate` so `onDragEnd` can refuse a drop that the
 * throttled `dragover` stream (C2) resolved to this id anyway. The "Add Group" button's
 * own at-cap behaviour (warn + upgrade toast) is unchanged.
 */
function NewGroupDropZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: NEW_GROUP_ID,
    data: { type: 'new-group' },
    disabled: !active
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="new-group-dropzone"
      aria-hidden={!active}
      className={cn(
        'absolute inset-y-0 left-1.5 right-1.5 z-10 flex items-center justify-center border border-dashed text-[11px] font-medium transition-colors',
        active ? 'border-primary text-foreground bg-zone-sidebar' : 'invisible pointer-events-none border-transparent',
        isOver && active && 'bg-primary/10 border-primary text-foreground'
      )}
    >
      <Plus className="h-3.5 w-3.5 mr-1 shrink-0" />
      Drop for a new group
    </div>
  );
}

export function SidePanel({ groupsState }: SidePanelProps) {
  const { isDragging, gap, active } = useDndContext();
  const setActiveGroupIndex = useUIStore((s) => s.setActiveGroupIndex);
  const activeGroupIndex = useUIStore((s) => s.activeGroupIndex);
  const selectionMode = useUIStore((s) => s.selectionMode);
  const setRenameTarget = useUIStore((s) => s.setRenameTarget);
  const openModal = useUIStore((s) => s.openModal);
  const { maxGroups, sessions: hasSessions } = useEntitlements();
  const { mutateAsync: addGroup } = useAddGroup();
  const { mutate: restoreGroup } = useRestoreGroup();
  const { mutate: deleteGroup } = useDeleteGroup();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const { data: sessions = [] } = useSessions();
  const { mutate: deleteSession } = useDeleteSession();
  const { mutate: restoreSession, isPending: restoring } = useRestoreSession();
  const { mutateAsync: saveSession } = useSaveSession();

  // Moved from Header (P4, popup-ui-consolidation-spec.md): "Save session" now lives in
  // the Sessions section header instead of the always-visible header icon bar.
  const handleSaveSession = () => {
    openModal('saveSession', {
      onSave: async (name: string, description?: string) => {
        try {
          await saveSession({ name, description, sessionCount: sessions.length, hasSessions });
          toast.success('Session saved');
        } catch (err) {
          if (err instanceof Error && err.message === 'SESSION_LIMIT') {
            toast.error('Free plan allows up to 3 sessions.', {
              action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
            });
          } else {
            toast.error('Failed to save session');
          }
        }
      }
    });
  };

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
  // (shared with `useArchiveGroup`'s "activate the group above" rule — see sidebarOrder.ts)
  let savedDisplayIdx = 0;
  const available = getSidebarDisplayOrder(raw).map(({ group: g, realIndex }) => {
    // ponytail: all non-permanent groups count toward free-tier limit (archived included)
    const isLocked = !g.permanent && isFinite(maxGroups) && isOverFreeLimit(savedDisplayIdx, maxGroups);
    if (!g.permanent) savedDisplayIdx++;
    return { group: g, realIndex, isLocked };
  });
  // MODEL ids — each visible group's real `group.id` (not positional "group-N").
  // Sensors / collision / drag handlers all come from the app-level <DndProvider>.
  const groupModelIds = available.map(({ group }) => group.id);

  // All non-permanent groups count toward the limit (archived included — archiving
  // doesn't free up slots).
  const atGroupLimit = raw.filter((g) => !g.permanent).length >= maxGroups;
  const warnGroupLimit = useCallback(() => {
    trackEvent('entitlement_limit_hit', { limit: 'maxGroups' });
    toast.error(`Free plan allows up to ${maxGroups} groups.`, {
      action: { label: 'Upgrade', onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
    });
  }, [maxGroups]);

  // The "new group" drop zone takes tab AND window drags (a group is already a group),
  // and is hidden outright at the free-group cap (user decision, 2026-09-18).
  const dropZoneActive = (active?.type === 'tab' || active?.type === 'window') && !atGroupLimit;

  // Publish the entitlement gate for the drop zone: `applyMove` is pure and `onDragEnd`
  // often resolves the target without dnd-kit's `over.data` (throttled `dragover`, C2),
  // so a drop can still name this id even though the zone is disabled — it is refused
  // there, silently, since a hidden zone was never offered to the user.
  useEffect(() => {
    setNewGroupZoneGate(atGroupLimit);
  }, [atGroupLimit]);

  const handleNewGroup = async () => {
    if (atGroupLimit) {
      warnGroupLimit();
      return;
    }
    const newIndex = raw.length;
    await addGroup({});
    setActiveGroupIndex(newIndex);
    setRenameTarget({ kind: 'group', groupIndex: newIndex });
  };

  return (
    <div
      className="flex flex-col h-full shrink-0 bg-zone-sidebar"
      style={{ width: 240, minWidth: 240, borderRight: '1px solid var(--zone-sidebar-border)' }}
    >
      {/* Groups list */}
      <ScrollArea className="flex-1">
        <div className="py-1.5">
          {/* List wrapper: grows by the gap height while a group drag's gap is here. */}
          <div data-tm-dnd-list="" style={dndListStyle(gapGrowthFor(gap, 'groups'), '0px')}>
          <SortableContext items={groupModelIds} strategy={verticalListSortingStrategy}>
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
          </div>

          {/* "Add Group" button + the "new group" drop zone share ONE box: they are never
              useful at the same time (the button is hidden for the whole drag), so the
              zone is absolutely positioned OVER it. That keeps the layout byte-identical
              whether or not a drag is running — no ancestor of a group grip ever changes
              height, which is what aborts a native HTML5 drag in the MV3 popup (C4).
              Both children stay MOUNTED for the same reason; only visibility flips. */}
          <div className="relative px-1.5 mt-2">
            <NewGroupDropZone active={dropZoneActive} />
            <div className={isDragging ? 'invisible' : undefined}>
              <Button
                variant="outline"
                className="h-8 rounded-none px-3 text-xs w-full"
                onClick={handleNewGroup}
                disabled={selectionMode || isDragging}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Group
              </Button>
            </div>
          </div>

        </div>
      </ScrollArea>

      {/* Archived + Sessions — pinned above stats footer. Both sections always render
          (header is always visible, even at 0 count); only the expanded body is gated. */}
      <div
        className="shrink-0"
        style={{ borderTop: '1px solid var(--zone-sidebar-border)' }}
      >
        <SidebarSection
          label="ARCHIVED"
          count={archivedGroups.length}
          open={archivedOpen}
          onToggle={() => setArchivedOpen((o) => !o)}
          isEmpty={archivedGroups.length === 0}
          emptyLabel="No archived groups"
          className="mt-1.5"
        >
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
        </SidebarSection>

        <SidebarSection
          label="SESSIONS"
          count={sessions.length}
          open={sessionsOpen}
          onToggle={() => setSessionsOpen((o) => !o)}
          isEmpty={sessions.length === 0}
          emptyLabel="No saved sessions"
          className="mt-1.5 mb-1.5"
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5"
                  onClick={handleSaveSession}
                  aria-label="Save current session"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Save current session</TooltipContent>
            </Tooltip>
          }
        >
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
                  {session.description && (
                    <span className="block truncate text-[9px] text-muted-foreground/70 italic" title={session.description}>
                      {session.description}
                    </span>
                  )}
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
        </SidebarSection>
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
