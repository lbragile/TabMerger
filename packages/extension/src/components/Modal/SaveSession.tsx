import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface SaveSessionModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/** Data-tab equivalent of Header's "Save session" action — replaces window.prompt(). */
export function SaveSessionModal({ data, onClose }: SaveSessionModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(false);
  const onSave = data.onSave as (name: string, description?: string) => void | Promise<void>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    void onSave(trimmed, description.trim() || undefined);
    onClose();
  };

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>Save Session</DialogTitle>
      </DialogHeader>

      <div className="space-y-1.5 py-4">
        <Label htmlFor="session-name" className="mb-1.5 block">Session name</Label>
        <Input
          id="session-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(false);
          }}
          placeholder="e.g. Work research, Weekend reading"
          autoFocus
        />
        {error && <p className="text-xs text-destructive">Session name is required</p>}
      </div>

      <div className="space-y-1.5 pb-4">
        <Label htmlFor="session-description" className="mb-1.5 block">Description (optional)</Label>
        <Textarea
          id="session-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this session for?"
          rows={3}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}
