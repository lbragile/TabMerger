import { useState } from 'react';
import { DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface SaveSessionModalProps {
  data: Record<string, unknown>;
  onClose: () => void;
}

/** Data-tab equivalent of Header's "Save session" action — replaces window.prompt(). */
export function SaveSessionModal({ data, onClose }: SaveSessionModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState(false);
  const onSave = data.onSave as (name: string) => void | Promise<void>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(true);
      return;
    }
    void onSave(trimmed);
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

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}
