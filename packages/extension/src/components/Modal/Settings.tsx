import { useState, useEffect, useRef } from 'react';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { getSetting, setSetting } from '@/lib/localDb';
import { applyTheme } from '@/lib/theme';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAuth } from '@/hooks/useAuth';
import { useGroups, useImportGroups } from '@/hooks/useGroups';
import { importGroups, parseBookmarksHtml, parseOneTabs } from '@/lib/importExport';
import { exportGroups } from '@/lib/importExport';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';

interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  confirmOnTabClose: boolean;
  confirmOnWindowClose: boolean;
  syncEnabled: boolean;
  openTabOnClick: boolean;
  autoDedupOnMerge: boolean;
  staleThresholdDays: 7 | 14 | 30 | 60;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  confirmOnTabClose: false,
  confirmOnWindowClose: true,
  syncEnabled: true,
  openTabOnClick: true,
  autoDedupOnMerge: false,
  staleThresholdDays: 30
};

function settingsEqual(a: AppSettings, b: AppSettings) {
  return (Object.keys(a) as (keyof AppSettings)[]).every((k) => a[k] === b[k]);
}

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [saved, setSaved] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const { tier, cloudSync } = useEntitlements();
  const { user, session, signOut } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);
  const { data: groupsState } = useGroups();
  const { mutate: importGroupsMutation } = useImportGroups();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSetting<AppSettings>('appSettings', DEFAULT_SETTINGS).then((s) => {
      setSaved(s);
      setDraft(s);
    });
  }, []);

  const isDirty = !settingsEqual(draft, saved);

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await setSetting('appSettings', draft);
    setSaved(draft);
    applyTheme(draft.theme);
    toast.success('Settings saved');
  };

  const handleRestoreDefaults = () => {
    setDraft(DEFAULT_SETTINGS);
  };

  const handleClearAll = async () => {
    if (!confirm('This will delete all groups and settings. Continue?')) return;
    const db = await import('@/lib/localDb').then((m) => m.getDb());
    await db.clear('groups');
    await db.clear('groupsState');
    await db.clear('sessions');
    await db.clear('settings');
    toast.success('All data cleared');
    onClose();
  };

  const handleExport = () => {
    if (!groupsState) return;
    const json = exportGroups(groupsState.available);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabmerger-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Groups exported successfully');
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      let groups: import('@/lib/types').Group[];
      if (ext === 'html') {
        groups = parseBookmarksHtml(text);
      } else if (ext === 'txt') {
        groups = parseOneTabs(text);
      } else {
        groups = importGroups(text);
      }
      if (groups.length === 0) throw new Error('No groups found');
      if (!confirm(`Import ${groups.length} group${groups.length === 1 ? '' : 's'}?`)) return;
      importGroupsMutation(groups, {
        onSuccess: () => {
          toast.success('Groups imported successfully');
          onClose();
        }
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid file format');
    }
  };

  const handleManageBilling = async () => {
    if (!session?.access_token) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_WEB_APP_URL}/api/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
      });
      const { url, error } = await res.json();
      if (error || !url) throw new Error(error ?? 'No portal URL');
      chrome.tabs.create({ url, active: true });
    } catch {
      toast.error('Could not open billing portal');
    } finally {
      setPortalLoading(false);
    }
  };

  const tierLabels: Record<string, string> = {
    free: 'Free',
    pro: 'Pro ($3.99/mo)',
    pro_ai: 'Pro AI ($7.99/mo)'
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
      </DialogHeader>

      <Tabs defaultValue="general" className="mt-4">
        <TabsList className="w-full">
          <TabsTrigger value="general" className="flex-1 text-xs">
            General
          </TabsTrigger>
          <TabsTrigger value="account" className="flex-1 text-xs">
            Account
          </TabsTrigger>
          <TabsTrigger value="data" className="flex-1 text-xs">
            Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Theme</Label>
              <p className="text-xs text-muted-foreground">Choose your preferred theme</p>
            </div>
            <Select
              value={draft.theme}
              onValueChange={(v) => patch('theme', v as AppSettings['theme'])}
            >
              <SelectTrigger className="w-28 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Confirm tab removal</Label>
              <p className="text-xs text-muted-foreground">Ask before removing a tab</p>
            </div>
            <Switch
              checked={draft.confirmOnTabClose}
              onCheckedChange={(v) => patch('confirmOnTabClose', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Confirm window removal</Label>
              <p className="text-xs text-muted-foreground">Ask before removing a window</p>
            </div>
            <Switch
              checked={draft.confirmOnWindowClose}
              onCheckedChange={(v) => patch('confirmOnWindowClose', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Open tab on click</Label>
              <p className="text-xs text-muted-foreground">Single click opens tab in browser</p>
            </div>
            <Switch
              checked={draft.openTabOnClick}
              onCheckedChange={(v) => patch('openTabOnClick', v)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto-deduplicate on merge</Label>
              <p className="text-xs text-muted-foreground">Remove duplicate tabs when merging windows</p>
            </div>
            <Switch
              checked={draft.autoDedupOnMerge}
              onCheckedChange={(v) => patch('autoDedupOnMerge', v)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Stale tab threshold</Label>
              <p className="text-xs text-muted-foreground">Show amber dot on tabs older than this</p>
            </div>
            <Select
              value={String(draft.staleThresholdDays ?? 30)}
              onValueChange={(v) => patch('staleThresholdDays', Number(v) as AppSettings['staleThresholdDays'])}
            >
              <SelectTrigger className="w-24 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="14">14 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="60">60 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="account" className="space-y-4 mt-4">
          <div className="rounded-md border border-border p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Plan</span>
              <span className="text-xs font-medium">{tierLabels[tier] ?? 'Free'}</span>
            </div>
            {user && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Email</span>
                <span className="text-xs">{user.email}</span>
              </div>
            )}
          </div>

          {!cloudSync && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() =>
                chrome.tabs.create({
                  url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
                  active: true
                })
              }
            >
              Upgrade to Pro
            </Button>
          )}

          {cloudSync && (
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Cloud sync</Label>
                <p className="text-xs text-muted-foreground">Sync groups to Supabase</p>
              </div>
              <Switch
                checked={draft.syncEnabled}
                onCheckedChange={(v) => patch('syncEnabled', v)}
              />
            </div>
          )}

          {tier !== 'free' && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => void handleManageBilling()}
              disabled={portalLoading}
            >
              {portalLoading ? 'Opening...' : 'Manage billing'}
            </Button>
          )}

          {user && (
            <Button variant="outline" onClick={() => void signOut()} className="w-full text-xs">
              Sign out
            </Button>
          )}
        </TabsContent>

        <TabsContent value="data" className="space-y-4 mt-4">
          <p className="text-xs text-muted-foreground">
            TabMerger stores all data locally in IndexedDB. Cloud sync requires a Pro account.
          </p>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Export data</Label>
              <p className="text-xs text-muted-foreground">Download all groups as a JSON file</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 shrink-0"
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Import data</Label>
              <p className="text-xs text-muted-foreground">Restore groups from a JSON export</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.html,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
            }}
          />

          <Separator />

          <Button variant="destructive" size="sm" className="w-full text-xs" onClick={handleClearAll}>
            Clear all data
          </Button>
        </TabsContent>
      </Tabs>

      {/* Footer — only shown for settings that need saving (General + Account sync toggle) */}
      <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground"
          onClick={handleRestoreDefaults}
        >
          Restore defaults
        </Button>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button
            size="sm"
            className="text-xs"
            disabled={!isDirty}
            onClick={() => void handleSave()}
          >
            Save changes
          </Button>
        </div>
      </div>
    </>
  );
}
