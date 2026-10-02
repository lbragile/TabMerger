import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteGroup, useDeleteWindow, useDeleteTab } from '@/hooks/useGroups';
import { useBulkDelete } from '@/hooks/useBulkActions';
import type { SelectedItem } from '@/stores/uiStore';
import { pluralize } from '@/lib/utils';

interface DeleteConfirmModalProps {
  type: 'deleteGroup' | 'deleteWindow' | 'deleteTab' | 'deleteSelection' | 'removeStaleTabs' | 'removeAllWindows' | 'archiveStaleGroups' | 'clearAllData' | 'resetEncryption';
  data: Record<string, unknown>;
  onClose: () => void;
}

export function DeleteConfirmModal({ type, data, onClose }: DeleteConfirmModalProps) {
  const { mutate: deleteGroup } = useDeleteGroup();
  const { mutate: deleteWindow } = useDeleteWindow();
  const { mutate: deleteTab } = useDeleteTab();
  const { mutate: bulkDelete } = useBulkDelete();

  const isNowOpen = data.isNowOpen as boolean | undefined;
  const items = data.items as SelectedItem[] | undefined;
  const selectionNoun = items?.[0]?.type === 'tab' ? 'tab' : items?.[0]?.type === 'window' ? 'window' : 'group';

  const labels: Record<string, { title: string; description: string; confirm: string }> = {
    deleteGroup: {
      title: 'Delete Group',
      description: `Are you sure you want to delete "${data.groupName as string}"? This cannot be undone.`,
      confirm: 'Delete',
    },
    deleteWindow: {
      title: isNowOpen ? 'Close Window' : 'Remove Window',
      description: isNowOpen
        ? 'Are you sure you want to close this window and all its tabs?'
        : 'Are you sure you want to remove this window and all its tabs?',
      confirm: isNowOpen ? 'Close' : 'Remove',
    },
    deleteTab: {
      title: isNowOpen ? 'Close Tab' : 'Remove Tab',
      description: isNowOpen
        ? 'Are you sure you want to close this tab?'
        : 'Are you sure you want to remove this tab?',
      confirm: isNowOpen ? 'Close' : 'Remove',
    },
    deleteSelection: {
      title: isNowOpen ? 'Close Selection' : 'Delete Selection',
      description: `Are you sure you want to ${isNowOpen ? 'close' : 'delete'} ${items?.length ?? 0} ${pluralize(items?.length ?? 0, selectionNoun)}? This cannot be undone.`,
      confirm: isNowOpen ? 'Close' : 'Delete',
    },
    removeStaleTabs: {
      title: 'Remove Stale Tabs',
      description: `Are you sure you want to remove ${data.count as number} stale ${pluralize(data.count as number, 'tab')}? This cannot be undone.`,
      confirm: 'Remove',
    },
    removeAllWindows: {
      title: isNowOpen ? 'Close All Windows' : 'Remove All Windows',
      description: isNowOpen
        ? 'Are you sure you want to close all browser windows and their tabs?'
        : 'Are you sure you want to remove all windows and their tabs from this group? This cannot be undone.',
      confirm: isNowOpen ? 'Close All' : 'Remove All',
    },
    archiveStaleGroups: {
      title: 'Archive Stale Groups',
      description: `Are you sure you want to archive ${data.count as number} stale ${pluralize(data.count as number, 'group')}?`,
      confirm: 'Archive',
    },
    clearAllData: {
      title: 'Clear All Data',
      description: 'This will permanently delete all groups, saved sessions, and settings. This cannot be undone.',
      confirm: 'Clear All Data',
    },
    resetEncryption: {
      title: 'Reset Encryption Passphrase',
      description:
        "This cannot be undone. All synced groups, sessions, and notes encrypted under your current passphrase will become permanently inaccessible. You'll set up a new passphrase and start syncing fresh.",
      confirm: 'Reset Passphrase',
    },
  };

  const { title, description, confirm } = labels[type] ?? labels.deleteGroup;

  const handleConfirm = () => {
    if (type === 'deleteGroup') {
      deleteGroup(data.groupIndex as number);
    } else if (type === 'deleteWindow') {
      deleteWindow({
        groupIndex: data.groupIndex as number,
        windowIndex: data.windowIndex as number
      });
    } else if (type === 'deleteTab') {
      deleteTab({
        groupIndex: data.groupIndex as number,
        windowIndex: data.windowIndex as number,
        tabIndex: data.tabIndex as number
      });
    } else if (type === 'deleteSelection' && items) {
      bulkDelete(items);
    } else if (type === 'removeStaleTabs' || type === 'removeAllWindows' || type === 'archiveStaleGroups' || type === 'clearAllData' || type === 'resetEncryption') {
      (data.onConfirm as () => void)?.();
    }
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-destructive">{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={handleConfirm}>
          {confirm}
        </Button>
      </DialogFooter>
    </>
  );
}
