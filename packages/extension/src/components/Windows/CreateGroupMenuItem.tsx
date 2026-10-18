import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { countedGroups } from '@/lib/tierLimits';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';

/**
 * Shared "Create new group" item appended to every move/copy-to-group menu
 * (Tab.tsx, Window.tsx, SelectionActionBar.tsx). Opens the existing AddGroup
 * modal with an `onCreated` callback that the modal fires with the new group's
 * index once it's saved — the caller uses that index to run its own move/copy, and returns its
 * promise: the add and the move are then one undo step (see AddGroupModal).
 * Reuses the same free-tier gate as SidePanel's "+" button (handleNewGroup).
 */
export function CreateGroupMenuItem({ onCreated }: { onCreated: (groupIndex: number) => Promise<unknown> }) {
  const { t } = useTranslation();
  const { data: groupsState } = useGroups();
  const { maxGroups } = useEntitlements();
  const openModal = useUIStore((s) => s.openModal);

  const handleClick = () => {
    const activeCount = countedGroups(groupsState?.available ?? []).length;
    if (activeCount >= maxGroups) {
      trackEvent('entitlement_limit_hit', { limit: 'maxGroups' });
      toast.error(t('common.freeGroupLimit', { max: maxGroups }), {
        action: { label: t('common.upgrade'), onClick: () => chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing` }) }
      });
      return;
    }
    openModal('addGroup', { onCreated });
  };

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="text-xs" onClick={handleClick}>
        <Plus className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
        {t('windows.createGroup')}
      </DropdownMenuItem>
    </>
  );
}
