import { useTranslation } from 'react-i18next';
import { BookmarkPlus, Plus } from 'lucide-react';
import { isTourDemoGroup } from '@tabmerger/shared';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu';
import type { Group } from '@/lib/types';
import type { RecentlyClosedEntry } from '@/lib/recentlyClosed';
import { siteGroupName, type ClosedSaveTarget } from '@/lib/recentlyClosedSave';

interface SaveToGroupMenuProps {
  /** Every group (the saved data); Now Open, archived groups and the tour's practice groups are left out. */
  groups: readonly Group[];
  /** What is saved (one entry, or a whole day for "Save all"); the new group is named after its first site. */
  entries: readonly RecentlyClosedEntry[];
  label: string;
  onSave: (target: ClosedSaveTarget, groupName: string) => void;
}

/**
 * "Save to group…" as a submenu of a ⋯ menu: the saved groups with their colours, the same list the
 * move/copy-to-group menus show, then "New group: github.com" (named after the site). Picking one
 * calls `onSave`; the write is the caller's (`useRecentlyClosedActions().saveToGroup`).
 */
export function SaveToGroupMenu({ groups, entries, label, onSave }: SaveToGroupMenuProps) {
  const { t } = useTranslation();
  const targets = groups.filter((g) => !g.permanent && !g.archived && !isTourDemoGroup(g));
  const site = siteGroupName(entries);
  const newName = site || t('recentlyClosed.entry.newGroupPlain');
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-xs">
        <BookmarkPlus className="me-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-48 w-52 overflow-y-auto text-xs">
        {targets.map((group) => (
          <DropdownMenuItem key={group.id} className="text-xs" onClick={() => onSave({ groupId: group.id }, group.name)}>
            <span aria-hidden className="me-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
            <span dir="auto" className="truncate text-ui-start">{group.name}</span>
          </DropdownMenuItem>
        ))}
        {targets.length === 0 && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            {t('recentlyClosed.entry.noGroups')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onClick={() => onSave({ newGroupName: site }, newName)}>
          <Plus className="me-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {site ? t('recentlyClosed.entry.newGroup', { name: site }) : t('recentlyClosed.entry.newGroupPlain')}
          </span>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
