import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useGroups, useImportGroups, useReplaceSavedGroups } from '@/hooks/useGroups';
import { useEntitlements } from '@/hooks/useEntitlements';
import { exportGroupsState, importGroupsState, parseBookmarksHtml, parseOneTabs, skippedContext } from '@/lib/importExport';
import { toast } from '@/lib/toast';
import { blockImportOverFreeLimit, countSavedGroupsAndTabs } from '@/lib/tierLimits';

interface ImportExportModalProps {
  mode: string;
  data: Record<string, unknown>;
  onClose: () => void;
}

export function ImportExportModal({ mode: initialMode, data: _data, onClose }: ImportExportModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>(initialMode === 'import' ? 'import' : 'export');
  const { data: groupsState } = useGroups();
  const replaceSavedGroups = useReplaceSavedGroups();
  const importGroups = useImportGroups();
  const { maxGroups, maxTabs } = useEntitlements();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bookmarksInputRef = useRef<HTMLInputElement>(null);
  const onetabInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    if (!groupsState) return;
    const json = exportGroupsState(groupsState);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabmerger-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('importExport.toast.exported'));
    onClose();
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      // Validates and rebuilds every group, window and tab; throws when the file is not a state export
      const { state: parsed, skipped } = importGroupsState(text);
      if (blockImportOverFreeLimit({ maxGroups, maxTabs }, [], parsed.available, 'replace')) return;
      // Replaces every saved group (Now Open is kept), as ONE undoable step, and asks for the
      // replaced groups' remote delete: the same path as restoring an automatic backup
      await replaceSavedGroups.mutateAsync(parsed.available.filter((g) => !g.permanent));
      toast.success(t('importExport.toast.imported', skippedContext(skipped)));
      onClose();
    } catch {
      toast.error(t('importExport.toast.invalidJson'));
    }
  };

  const handleBookmarksImport = async (file: File) => {
    const html = await file.text();
    const { groups, skipped } = parseBookmarksHtml(html);
    if (groups.length === 0) { toast.error(t('importExport.toast.noBookmarks')); return; }
    if (blockImportOverFreeLimit({ maxGroups, maxTabs }, groupsState?.available ?? [], groups, 'append')) return;
    const imported = countSavedGroupsAndTabs(groups);
    await importGroups.mutateAsync(groups);
    toast.success(t('importExport.toast.importedCounts', { groups: t('common.groupCount', { count: imported.groups }), tabs: t('common.tabCount', { count: imported.tabs }), ...skippedContext(skipped) }));
    onClose();
  };

  const handleOneTabImport = async (file: File) => {
    const text = await file.text();
    const { groups, skipped } = parseOneTabs(text);
    if (groups.length === 0) { toast.error(t('importExport.toast.noTabs')); return; }
    if (blockImportOverFreeLimit({ maxGroups, maxTabs }, groupsState?.available ?? [], groups, 'append')) return;
    const imported = countSavedGroupsAndTabs(groups);
    await importGroups.mutateAsync(groups);
    toast.success(t('importExport.toast.importedCounts', { groups: t('common.groupCount', { count: imported.groups }), tabs: t('common.tabCount', { count: imported.tabs }), ...skippedContext(skipped) }));
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('importExport.title')}</DialogTitle>
        <DialogDescription>{t('importExport.description')}</DialogDescription>
      </DialogHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="export" className="flex-1 text-xs">{t('importExport.tabExport')}</TabsTrigger>
          <TabsTrigger value="import" className="flex-1 text-xs">{t('importExport.tabImport')}</TabsTrigger>
        </TabsList>

        <TabsContent value="export" className="space-y-3 mt-3">
          <p className="text-sm text-muted-foreground">
            {t('importExport.exportIntro')}
          </p>
          <Button onClick={handleExport} className="w-full">
            {t('importExport.downloadJson')}
          </Button>
        </TabsContent>

        <TabsContent value="import" className="space-y-4 mt-3">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('importExport.jsonHeading')}</p>
            <p className="text-sm text-muted-foreground">
              {t('importExport.jsonIntro')}
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
              {t('importExport.chooseJson')}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('importExport.bookmarksHeading')}</p>
            <p className="text-sm text-muted-foreground">
              {t('importExport.bookmarksIntro')}
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
              {t('importExport.chooseBookmarks')}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('importExport.oneTabHeading')}</p>
            <p className="text-sm text-muted-foreground">
              {t('importExport.oneTabIntro')}
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
              {t('importExport.chooseOneTab')}
            </Button>
          </div>
        </TabsContent>

      </Tabs>
    </>
  );
}
