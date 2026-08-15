import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/ColorPicker';
import { useAddGroup, useGroups } from '@/hooks/useGroups';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from '@/lib/types';

interface AddGroupModalProps {
  onClose: () => void;
  /** Optional — set when this modal was opened from a "Create new group" move/copy menu item. */
  data?: Record<string, unknown>;
}

export function AddGroupModal({ onClose, data }: AddGroupModalProps) {
  const [name, setName] = useState(DEFAULT_GROUP_TITLE);
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  const { mutate: addGroup, isPending } = useAddGroup();
  const { data: groupsState } = useGroups();
  const onCreated = data?.onCreated as ((groupIndex: number) => void) | undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // New group is always appended, so its index is the current length — capture before the mutation lands.
    const newIndex = groupsState?.available.length ?? 0;
    // Close only after the mutation settles — closing synchronously unmounts this component
    // (and its useAddGroup() observer) before the async mutationFn resolves, so the mutate-level
    // onSuccess below (tied to that observer, not the mutation cache) would silently never fire,
    // meaning onCreated (which does the actual move/copy) never runs even though the group is created.
    addGroup(
      { name: name.trim() || DEFAULT_GROUP_TITLE, color },
      {
        onSuccess: () => {
          onCreated?.(newIndex);
          onClose();
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Create New Group</DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label>Color</Label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}
