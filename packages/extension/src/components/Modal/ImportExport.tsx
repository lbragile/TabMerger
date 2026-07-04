import { useState, useRef } from 'react';
import { DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useGroups, useSetGroupsState } from '@/hooks/useGroups';
import { useUpdateGroupInfo } from '@/hooks/useGroups';
import type { GroupsState } from '@/lib/types';
import { toast } from 'sonner';

interface ImportExportModalProps {
  mode: string;
  data: Record<string, unknown>;
  onClose: () => void;
}

export function ImportExportModal({ mode: initialMode, data, onClose }: ImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<string>(
    data.mode === 'note' ? 'note' : initialMode === 'import' ? 'import' : 'export'
  );
  const [noteValue, setNoteValue] = useState('');
  const { data: groupsState } = useGroups();
  const setGroupsState = useSetGroupsState();
  const { mutate: updateGroupInfo } = useUpdateGroupInfo();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    if (!groupsState) return;
    const json = JSON.stringify(groupsState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabmerger-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Groups exported successfully');
    onClose();
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as GroupsState;
      if (!parsed.available || !Array.isArray(parsed.available)) {
        throw new Error('Invalid format');
      }
      await setGroupsState(parsed);
      toast.success('Groups imported successfully');
      onClose();
    } catch {
      toast.error('Invalid JSON file');
    }
  };

  const handleSaveNote = () => {
    const groupIndex = data.groupIndex as number;
    if (groupIndex !== undefined) {
      updateGroupInfo({ groupIndex, info: noteValue });
    }
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import / Export</DialogTitle>
        <DialogDescription>Manage your TabMerger data</DialogDescription>
      </DialogHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="export" className="flex-1 text-xs">
            Export
          </TabsTrigger>
          <TabsTrigger value="import" className="flex-1 text-xs">
            Import
          </TabsTrigger>
          {data.mode === 'note' && (
            <TabsTrigger value="note" className="flex-1 text-xs">
              Note
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="export" className="space-y-3 mt-3">
          <p className="text-sm text-muted-foreground">
            Export all your groups as a JSON file. You can re-import this file later.
          </p>
          <Button onClick={handleExport} className="w-full">
            Download JSON
          </Button>
        </TabsContent>

        <TabsContent value="import" className="space-y-3 mt-3">
          <p className="text-sm text-muted-foreground">
            Import groups from a previously exported JSON file. This will replace your current
            groups.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full">
            Choose JSON file
          </Button>
        </TabsContent>

        {data.mode === 'note' && (
          <TabsContent value="note" className="space-y-3 mt-3">
            <Label htmlFor="group-note">Group Note</Label>
            <Textarea
              id="group-note"
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              placeholder="Add a note to this group..."
              rows={4}
            />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSaveNote}>Save Note</Button>
            </DialogFooter>
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
