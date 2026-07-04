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

  const labels: Record<string, { title: string; description: string }> = {
    deleteGroup: {
      title: 'Delete Group',
      description: `Are you sure you want to delete "${data.groupName as string}"? This cannot be undone.`
    },
    deleteWindow: {
      title: 'Delete Window',
      description: 'Are you sure you want to delete this window and all its tabs?'
    },
    deleteTab: {
      title: 'Delete Tab',
      description: 'Are you sure you want to remove this tab?'
    }
  };

  const { title, description } = labels[type] ?? labels.deleteGroup;

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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={handleConfirm}>
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}
