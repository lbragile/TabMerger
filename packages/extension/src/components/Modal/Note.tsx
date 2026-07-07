import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useGroups, useUpdateGroupNote } from '@/hooks/useGroups';

interface NoteModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

export function NoteModal({ data, onClose }: NoteModalProps) {
  const groupIndex = data.groupIndex as number;
  const { data: groupsState } = useGroups();
  const existingNote = groupsState?.available[groupIndex]?.note ?? '';
  const [noteValue, setNoteValue] = useState(existingNote);
  const { mutate: updateGroupNote } = useUpdateGroupNote();

  const handleSave = () => {
    updateGroupNote({ groupIndex, note: noteValue });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Group Note</DialogTitle>
        <DialogDescription>Add or edit a note for this group</DialogDescription>
      </DialogHeader>
      <Textarea
        className="mt-4"
        value={noteValue}
        onChange={(e) => setNoteValue(e.target.value)}
        placeholder="Add a note to this group..."
        rows={5}
        autoFocus
      />
      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>Save</Button>
      </DialogFooter>
    </>
  );
}
