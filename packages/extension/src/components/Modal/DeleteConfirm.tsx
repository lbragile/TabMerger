import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteGroup, useDeleteWindow, useDeleteTab } from '@/hooks/useGroups';
import { useBulkDelete } from '@/hooks/useBulkActions';
import type { SelectedItem } from '@/stores/uiStore';
import { useTranslation } from 'react-i18next';

interface DeleteConfirmModalProps {
  type: 'deleteGroup' | 'deleteWindow' | 'deleteTab' | 'deleteSelection' | 'removeStaleTabs' | 'removeAllWindows' | 'archiveStaleGroups' | 'clearAllData' | 'resetEncryption';
  data: Record<string, unknown>;
  onClose: () => void;
}

export function DeleteConfirmModal({ type, data, onClose }: DeleteConfirmModalProps) {
  const { t } = useTranslation();
  const { mutate: deleteGroup } = useDeleteGroup();
  const { mutate: deleteWindow } = useDeleteWindow();
  const { mutate: deleteTab } = useDeleteTab();
  const { mutate: bulkDelete } = useBulkDelete();

  const isNowOpen = data.isNowOpen as boolean | undefined;
  const items = data.items as SelectedItem[] | undefined;
  const selectionNoun = items?.[0]?.type === 'tab' ? 'tab' : items?.[0]?.type === 'window' ? 'window' : 'group';

  const labels: Record<string, { title: string; description: string; confirm: string }> = {
    deleteGroup: {
      title: t('confirm.deleteGroup.title'),
      description: t('confirm.deleteGroup.description', { name: data.groupName as string }),
      confirm: t('confirm.deleteGroup.confirm'),
    },
    deleteWindow: isNowOpen
      ? { title: t('confirm.closeWindow.title'), description: t('confirm.closeWindow.description'), confirm: t('confirm.closeWindow.confirm') }
      : { title: t('confirm.removeWindow.title'), description: t('confirm.removeWindow.description'), confirm: t('confirm.removeWindow.confirm') },
    deleteTab: isNowOpen
      ? { title: t('confirm.closeTab.title'), description: t('confirm.closeTab.description'), confirm: t('confirm.closeTab.confirm') }
      : { title: t('confirm.removeTab.title'), description: t('confirm.removeTab.description'), confirm: t('confirm.removeTab.confirm') },
    deleteSelection: isNowOpen
      ? {
          title: t('confirm.closeSelection.title'),
          description: t('confirm.closeSelection.description', { count: items?.length ?? 0, context: selectionNoun }),
          confirm: t('confirm.closeSelection.confirm'),
        }
      : {
          title: t('confirm.deleteSelection.title'),
          description: t('confirm.deleteSelection.description', { count: items?.length ?? 0, context: selectionNoun }),
          confirm: t('confirm.deleteSelection.confirm'),
        },
    removeStaleTabs: {
      title: t('confirm.removeStaleTabs.title'),
      description: t('confirm.removeStaleTabs.description', { count: data.count as number }),
      confirm: t('confirm.removeStaleTabs.confirm'),
    },
    removeAllWindows: isNowOpen
      ? { title: t('confirm.closeAllWindows.title'), description: t('confirm.closeAllWindows.description'), confirm: t('confirm.closeAllWindows.confirm') }
      : { title: t('confirm.removeAllWindows.title'), description: t('confirm.removeAllWindows.description'), confirm: t('confirm.removeAllWindows.confirm') },
    archiveStaleGroups: {
      title: t('confirm.archiveStaleGroups.title'),
      description: t('confirm.archiveStaleGroups.description', { count: data.count as number }),
      confirm: t('confirm.archiveStaleGroups.confirm'),
    },
    clearAllData: {
      title: t('confirm.clearAllData.title'),
      // The longer text is only used when the caller has seen automatic backups in the
      // signed-in account (Settings passes `cloudBackupsKept: true`): the wipe is local.
      description: t('confirm.clearAllData.description', { context: data.cloudBackupsKept === true ? 'kept' : undefined }),
      confirm: t('confirm.clearAllData.confirm'),
    },
    resetEncryption: {
      title: t('confirm.resetEncryption.title'),
      description: t('confirm.resetEncryption.description'),
      confirm: t('confirm.resetEncryption.confirm'),
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
          {t('confirm.cancel')}
        </Button>
        <Button variant="destructive" onClick={handleConfirm}>
          {confirm}
        </Button>
      </DialogFooter>
    </>
  );
}
