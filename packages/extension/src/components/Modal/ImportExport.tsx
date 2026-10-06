import { useState, useRef } from 'react';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useGroups, useSetGroupsState, useImportGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import type { GroupsState } from '@/lib/types';
import { parseBookmarksHtml, parseOneTabs } from '@/lib/importExport';
import { toast } from '@/lib/toast';
import { prepareImportedState } from '@/lib/syncDirty';
import { blockImportOverFreeLimit, countSavedGroupsAndTabs } from '@/lib/tierLimits';

interface ImportExportModalProps {
  mode: string;
  data: Record<string, unknown>;
  onClose: () => void;
}

export function ImportExportModal({ mode: initialMode, data: _data, onClose }: ImportExportModalProps) {
  const [activeTab, setActiveTab] = useState<string>(initialMode === 'import' ? 'import' : 'export');
  const { data: groupsState } = useGroups();
  const setGroupsState = useSetGroupsState();
  const importGroups = useImportGroups();
  const { maxGroups, maxTabs } = useEntitlements();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bookmarksInputRef = useRef<HTMLInputElement>(null);
  const onetabInputRef = useRef<HTMLInputElement>(null);

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
      if (blockImportOverFreeLimit({ maxGroups, maxTabs }, [], parsed.available, 'replace')) return;
      await setGroupsState(prepareImportedState(parsed, groupsState));
      toast.success('Groups imported successfully');
      onClose();
    } catch {
      toast.error('Invalid JSON file');
    }
  };

  const handleBookmarksImport = async (file: File) => {
    const html = await file.text();
    const groups = parseBookmarksHtml(html);
    if (groups.length === 0) { toast.error('No bookmarks found'); return; }
    if (blockImportOverFreeLimit({ maxGroups, maxTabs }, groupsState?.available ?? [], groups, 'append')) return;
    const imported = countSavedGroupsAndTabs(groups);
    await importGroups.mutateAsync(groups);
    toast.success(`Imported ${imported.groups} group${imported.groups !== 1 ? 's' : ''}, ${imported.tabs} tab${imported.tabs !== 1 ? 's' : ''}`);
    onClose();
  };

  const handleOneTabImport = async (file: File) => {
    const text = await file.text();
    const groups = parseOneTabs(text);
    if (groups.length === 0) { toast.error('No tabs found'); return; }
    if (blockImportOverFreeLimit({ maxGroups, maxTabs }, groupsState?.available ?? [], groups, 'append')) return;
    const imported = countSavedGroupsAndTabs(groups);
    await importGroups.mutateAsync(groups);
    toast.success(`Imported ${imported.groups} group${imported.groups !== 1 ? 's' : ''}, ${imported.tabs} tab${imported.tabs !== 1 ? 's' : ''}`);
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
          <TabsTrigger value="export" className="flex-1 text-xs">Export</TabsTrigger>
          <TabsTrigger value="import" className="flex-1 text-xs">Import</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="space-y-3 mt-3">
          <p className="text-sm text-muted-foreground">
            Export all your groups as a JSON file. You can re-import this file later.
          </p>
          <Button onClick={handleExport} className="w-full">
            Download JSON
          </Button>
        </TabsContent>

        <TabsContent value="import" className="space-y-4 mt-3">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">TabMerger JSON</p>
            <p className="text-sm text-muted-foreground">
              Import from a previously exported JSON file. Replaces current groups.
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
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chrome Bookmarks</p>
            <p className="text-sm text-muted-foreground">
              Import from a Chrome bookmarks HTML export. Each folder becomes a group.
            </p>
            <input
              ref={bookmarksInputRef}
              type="file"
              accept=".html"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleBookmarksImport(file);
              }}
            />
            <Button variant="outline" onClick={() => bookmarksInputRef.current?.click()} className="w-full">
              Choose Bookmarks HTML file
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">OneTab</p>
            <p className="text-sm text-muted-foreground">
              Import from a OneTab plain-text export. Each blank-line-separated block becomes a group.
            </p>
            <input
              ref={onetabInputRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleOneTabImport(file);
              }}
            />
            <Button variant="outline" onClick={() => onetabInputRef.current?.click()} className="w-full">
              Choose OneTab TXT file
            </Button>
          </div>
        </TabsContent>

      </Tabs>
    </>
  );
}
