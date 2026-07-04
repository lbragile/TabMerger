import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorPicker } from '@/components/ColorPicker';
import { useAddGroup } from '@/hooks/useGroups';
import { DEFAULT_GROUP_COLOR, DEFAULT_GROUP_TITLE } from '@/lib/types';

interface AddGroupModalProps {
  onClose: () => void;
}

export function AddGroupModal({ onClose }: AddGroupModalProps) {
  const [name, setName] = useState(DEFAULT_GROUP_TITLE);
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  const { mutate: addGroup, isPending } = useAddGroup();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addGroup({ name: name.trim() || DEFAULT_GROUP_TITLE, color });
    onClose();
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
