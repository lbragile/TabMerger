import { Trash2, MoveRight, Copy, Star, X, Share2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useUIStore } from '@/stores/uiStore';
import { useGroups } from '@/hooks/useGroups';
import { useBulkDelete, useBulkMoveToGroup, useBulkStar, parseGroupId } from '@/hooks/useBulkActions';
import { cn, pluralize } from '@/lib/utils';
import { useState } from 'react';
import { CreateGroupMenuItem } from '@/components/Windows/CreateGroupMenuItem';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useEntitlements } from '@/hooks/useEntitlements';
import { createSharedBundle } from '@/lib/sharing';
import { getSetting } from '@/lib/localDb';

/** Maps a selection type to a human-readable plural noun. */
function itemLabel(type: string, count: number): string {
  const noun = type === 'tab' ? 'tab' : type === 'window' ? 'window' : 'group';
  return `${count} ${pluralize(count, noun)} selected`;
}

/** Parse the source groupIndex from the first selected item ID. */
function sourceGroupIndex(id: string): number {
  const m = id.match(/^(?:tab|window)-(\d+)/);
  return m ? +m[1] : -1;
}

export function SelectionActionBar() {
  const selectedItems = useUIStore((s) => s.selectedItems);
  const exitSelectionMode = useUIStore((s) => s.exitSelectionMode);
  const openModal = useUIStore((s) => s.openModal);
  const { data: groupsState } = useGroups();
  const { mutate: bulkDelete, isPending: isDeleting } = useBulkDelete();
  const { mutate: bulkMove, isPending: isMoving } = useBulkMoveToGroup();
  const { mutate: bulkStar, isPending: isStarring } = useBulkStar();
  const entitlements = useEntitlements();
  const [isSharing, setIsSharing] = useState(false);

  if (selectedItems.length === 0) return null;

  const type = selectedItems[0].type;
  const canMove = type !== 'group';
  const canStar = type !== 'tab';
  const canShare = type === 'group';
  const isPending = isDeleting || isMoving || isStarring || isSharing;

  async function handleShare() {
    const allGroups = groupsState?.available ?? [];
    const groupIds = selectedItems
      .map((s) => parseGroupId(s.id))
      .filter((p): p is { groupIndex: number } => p !== null)
      .map((p) => allGroups[p.groupIndex]?.id)
      .filter((id): id is string => id !== undefined);
    const entitlement = { tier: entitlements.tier, sharing: entitlements.cloudSync };
    setIsSharing(true);
    try {
      const url = await createSharedBundle(groupIds, allGroups, supabase, entitlement);
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to share');
    } finally {
      setIsSharing(false);
    }
  }

  const srcIndex = sourceGroupIndex(selectedItems[0].id);
  const isNowOpen = groupsState?.available[srcIndex]?.permanent ?? false;

  // Same archived exclusion as Tab.tsx/Window.tsx's per-item "move to group" menus.
  const targetGroups =
    groupsState?.available
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => !group.archived) ?? [];

  async function handleDelete() {
    const { confirmOnDelete } = await getSetting<{ confirmOnDelete: boolean }>(
      'appSettings',
      { confirmOnDelete: false }
    );
    if (confirmOnDelete) {
      openModal('deleteSelection', { items: selectedItems, isNowOpen });
    } else {
      bulkDelete(selectedItems);
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/60 backdrop-blur-sm shrink-0',
        'text-xs'
      )}
    >
      {/* Count label */}
      <span className="flex-1 font-medium text-foreground">
        {itemLabel(type, selectedItems.length)}
      </span>

      {/* Move / Copy to group — only for tabs and windows */}
      {canMove && groupsState && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs gap-1"
              disabled={isPending}
            >
              {isNowOpen ? <Copy className="h-3.5 w-3.5" /> : <MoveRight className="h-3.5 w-3.5" />}
              {isNowOpen ? 'Copy to group' : 'Move to group'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-xs max-h-56 overflow-y-auto">
            {targetGroups.map(({ group, index }) => (
              <DropdownMenuItem
                key={group.id}
                className="text-xs"
                onClick={() => bulkMove({ items: selectedItems, targetGroupIndex: index })}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0 mr-2"
                  style={{ backgroundColor: group.color }}
                />
                <span className="truncate">{group.name}</span>
              </DropdownMenuItem>
            ))}
            <CreateGroupMenuItem
              onCreated={(index) => bulkMove({ items: selectedItems, targetGroupIndex: index })}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Star / Unstar — windows and groups only */}
      {canStar && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            disabled={isPending}
            onClick={() => bulkStar({ items: selectedItems, starred: true })}
          >
            <Star className="h-3.5 w-3.5" fill="currentColor" />
            Star
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            disabled={isPending}
            onClick={() => bulkStar({ items: selectedItems, starred: false })}
          >
            <Star className="h-3.5 w-3.5" />
            Unstar
          </Button>
        </>
      )}

      {/* Share — groups only */}
      {canShare && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          disabled={isPending || !entitlements.cloudSync}
          title={!entitlements.cloudSync ? 'Sharing requires Pro' : undefined}
          onClick={handleShare}
        >
          {isSharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
          Share
        </Button>
      )}

      {/* Delete / Close */}
      <Button
        variant="destructive"
        size="sm"
        className="h-7 px-2 text-xs gap-1"
        disabled={isPending}
        onClick={handleDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {isNowOpen ? 'Close' : 'Delete'}
      </Button>

      {/* Cancel */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        disabled={isPending}
        onClick={exitSelectionMode}
        aria-label="Cancel selection"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
