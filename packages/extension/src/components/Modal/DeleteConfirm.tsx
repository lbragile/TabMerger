import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteGroup, useDeleteWindow, useDeleteTab } from '@/hooks/useGroups';

interface DeleteConfirmModalProps {
  type: 'deleteGroup' | 'deleteWindow' | 'deleteTab';
  data: Record<string, unknown>;
  onClose: () => void;
}

export function DeleteConfirmModal({ type, data, onClose }: DeleteConfirmModalProps) {
  const { mutate: deleteGroup } = useDeleteGroup();
  const { mutate: deleteWindow } = useDeleteWindow();
  const { mutate: deleteTab } = useDeleteTab();

  const isNowOpen = data.isNowOpen as boolean | undefined;

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
