import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setDevAiUsage } from '@/mocks/devAiUsage';
import { aiPost } from '@/hooks/useAI';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { applyTheme } from '@/lib/theme';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAuth } from '@/hooks/useAuth';
import { useGroups, useImportGroups } from '@/hooks/useGroups';
import { useAppSettings, useSaveAppSettings, DEFAULT_APP_SETTINGS, type AppSettings } from '@/hooks/useAppSettings';
import { useAiUsage } from '@/hooks/useAiUsage';
import { importGroups, parseBookmarksHtml, parseOneTabs } from '@/lib/importExport';
import { exportGroups } from '@/lib/importExport';
import { enterDemoMode } from '@/lib/demo';
import { OtherDevices } from '@/components/Settings/OtherDevices';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';
import { hasEncryptionKey, resetEncryption } from '@/lib/encryptionKey';
import { AI_ENABLED } from '@/lib/aiFlag';

function settingsEqual(a: AppSettings, b: AppSettings) {
  return (Object.keys(a) as (keyof AppSettings)[]).every((k) => a[k] === b[k]);
}

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState('general');
  const [devUsageInput, setDevUsageInput] = useState('0');
  const queryClient = useQueryClient();
  // `saved` is the query's current value (reactive — reflects saves made elsewhere,
  // e.g. another mount of this modal, and refetches after login via useSync's invalidate).
  const { data: saved = DEFAULT_APP_SETTINGS } = useAppSettings();
  const { mutateAsync: saveAppSettings } = useSaveAppSettings();
  const [draft, setDraft] = useState<AppSettings>(saved);
  const { tier, cloudSync, currentPeriodEnd, aiFeatures } = useEntitlements();
  const { remaining: aiUsageRemaining, cap: aiUsageCap, loading: aiUsageLoading } = useAiUsage();
  const { user, session, signOut } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);
  const { data: groupsState } = useGroups();
  const { mutate: importGroupsMutation } = useImportGroups();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openModal = useUIStore((s) => s.openModal);
  const [canResetEncryption, setCanResetEncryption] = useState(false);

  useEffect(() => {
    if (!user) return;
    void hasEncryptionKey().then(setCanResetEncryption);
  }, [user]);

  const handleResetEncryption = () => {
    openModal('resetEncryption', {
      onConfirm: () => {
        void resetEncryption()
          .then(() => {
            toast.success('Encryption reset — set up a new passphrase');
            openModal('encryptionSetup');
          })
          .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to reset encryption'));
      }
    });
  };

  // Sets the dev-only local mock counter (still read by useAiUsage in DEV — see its
  // own comment) AND writes the same count to the real Supabase ai_usage table via
  // /api/ai/dev-usage, so real server-side quota enforcement can be exercised
  // end-to-end for the signed-in account, not just the local mock UI state.
  const handleSyncDevUsage = async (count: number) => {
    await setDevAiUsage(count);
    queryClient.invalidateQueries({ queryKey: ['aiUsage', user?.id] });
    if (!session?.access_token) {
      toast.error('Sign in to sync AI usage to the server');
      return;
    }
    try {
      await aiPost<{ count: number }>('/api/ai/dev-usage', { count }, session.access_token);
      toast.success(`Server AI usage set to ${count}`);
    } catch {
      toast.error('Failed to sync AI usage to server');
    }
  };

  // Re-seed the draft whenever the underlying query value changes (initial load
  // resolving, a save made elsewhere, or a post-login refetch) — but only while
  // the user has no unsaved edits, so this never clobbers in-progress changes.
  const prevSavedRef = useRef(saved);
  useEffect(() => {
    if (saved !== prevSavedRef.current) {
      // Capture the previous value before mutating the ref — setDraft's updater runs
      // asynchronously, so reading prevSavedRef.current from inside it would see the
      // already-mutated value instead of the one we need to compare the draft against.
      const previouslySynced = prevSavedRef.current;
      prevSavedRef.current = saved;
      setDraft((prev) => (settingsEqual(prev, previouslySynced) ? saved : prev));
    }
  }, [saved]);

  const isDirty = !settingsEqual(draft, saved);

  // upgrade_prompt_shown pairs with the upgrade_clicked fired below — fire once per mount when the CTA is visible
  useEffect(() => {
    if (!cloudSync) trackEvent('upgrade_prompt_shown', { source: 'settings' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (draft.syncEnabled && !saved.syncEnabled) trackEvent('sync_enabled');
    await saveAppSettings(draft);
    applyTheme(draft.theme);
    toast.success('Settings saved');
  };

  const handleRestoreDefaults = () => {
    setDraft(DEFAULT_APP_SETTINGS);
  };

  const performClearAll = async () => {
    const db = await import('@/lib/localDb').then((m) => m.getDb());
    await db.clear('groups');
    await db.clear('groupsState');
    await db.clear('sessions');
    await db.clear('settings');
    toast.success('All data cleared');
    onClose();
  };

  const handleClearAll = () => {
    openModal('clearAllData', { onConfirm: () => void performClearAll() });
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 min-w-0">
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
          {tier !== 'free' && (
            <TabsTrigger value="devices" className="flex-1 text-xs">
              Devices
            </TabsTrigger>
          )}
          {aiFeatures && (
            <TabsTrigger value="ai" className="flex-1 text-xs">
              AI
            </TabsTrigger>
          )}
          {(import.meta.env.DEV || import.meta.env.VITE_DEMO_BUILD === 'true') && (
            <TabsTrigger value="dev" className="flex-1 text-xs">
              Dev
            </TabsTrigger>
          )}
        </TabsList>

        <div className="mt-4 max-h-[320px] min-w-0 overflow-y-auto overflow-x-hidden pr-1">
        <TabsContent value="general" className="space-y-4">
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

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Confirm before deleting</Label>
              <p className="text-xs text-muted-foreground">Ask before deleting groups or saved windows</p>
            </div>
            <Switch
              checked={draft.confirmOnDelete}
              onCheckedChange={(v) => patch('confirmOnDelete', v)}
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

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Show page images in previews</Label>
              <p className="text-xs text-muted-foreground">
                When on, hovering a tab sends that tab&apos;s web address to TabMerger&apos;s
                preview service to fetch its image. It isn&apos;t linked to your account,
                logged, or stored.
              </p>
            </div>
            <Switch
              aria-label="Show page images in previews"
              checked={draft.showPreviewImages}
              onCheckedChange={(v) => {
                if (v) {
                  openModal('confirmPreviewImages', { onConfirm: () => patch('showPreviewImages', true) });
                } else {
                  patch('showPreviewImages', false);
                }
              }}
            />
          </div>

          {cloudSync && (
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Cloud sync</Label>
                <p className="text-xs text-muted-foreground">Sync groups across your devices</p>
              </div>
              <Switch
                checked={draft.syncEnabled}
                onCheckedChange={(v) => patch('syncEnabled', v)}
              />
            </div>
          )}

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

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">URL rules</Label>
              <p className="text-xs text-muted-foreground">
                Auto-assign newly-opened tabs to a group by URL pattern
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs shrink-0 rounded-none"
              onClick={() => openModal('urlRules')}
            >
              Manage
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="account" className="space-y-4">
          <div className="border border-border p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Plan</span>
              <span className="text-xs font-medium">{tierLabels[tier] ?? 'Free'}</span>
            </div>
            {tier !== 'free' && currentPeriodEnd && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Renews</span>
                <span className="text-xs font-medium">
                  {new Date(currentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>
            )}
            {user && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Email</span>
                <span className="text-xs">{user.email}</span>
              </div>
            )}
            {aiFeatures && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">AI credits left this month</span>
                <span className="text-xs font-medium">
                  {aiUsageLoading ? '…' : `${aiUsageRemaining} / ${aiUsageCap}`}
                </span>
              </div>
            )}
          </div>

          {!cloudSync && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs rounded-none"
              onClick={() => {
                trackEvent('upgrade_clicked', { source: 'settings' });
                chrome.tabs.create({
                  url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`,
                  active: true
                });
              }}
            >
              Upgrade to Pro
            </Button>
          )}

          {tier !== 'free' && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs rounded-none"
              onClick={() => void handleManageBilling()}
              disabled={portalLoading}
            >
              {portalLoading ? 'Opening...' : 'Manage billing'}
            </Button>
          )}

          {user && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              className="w-full text-xs rounded-none hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
            >
              Sign out
            </Button>
          )}

          {canResetEncryption && (
            <div className="pt-2 border-t border-border text-center">
              <Button
                variant="link"
                size="sm"
                onClick={handleResetEncryption}
                className="h-auto p-0 text-xs text-destructive"
              >
                Forgot your passphrase? Reset encryption
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
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
              className="text-xs gap-1.5 shrink-0 rounded-none"
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
              className="text-xs gap-1.5 shrink-0 rounded-none"
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

          <Button variant="destructive" size="sm" className="w-full text-xs rounded-none" onClick={handleClearAll}>
            Clear all data
          </Button>
        </TabsContent>

        {tier !== 'free' && (
          <TabsContent value="devices" className="space-y-4">
            <OtherDevices />
          </TabsContent>
        )}

        {aiFeatures && (
          <TabsContent value="ai" className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Every AI action below draws from the same monthly AI quota (see Account tab).
              Turn off features you don&apos;t use to save quota for the ones you do.
            </p>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Auto-group</Label>
                <p className="text-xs text-muted-foreground">Group open tabs with AI</p>
              </div>
              <Switch
                checked={draft.aiAutoGroupEnabled}
                onCheckedChange={(v) => patch('aiAutoGroupEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Name group</Label>
                <p className="text-xs text-muted-foreground">Suggest a name for a group with AI</p>
              </div>
              <Switch
                checked={draft.aiNameGroupEnabled}
                onCheckedChange={(v) => patch('aiNameGroupEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Suggest sessions</Label>
                <p className="text-xs text-muted-foreground">Background banner suggesting when to save a session</p>
              </div>
              <Switch
                checked={draft.aiSuggestSessionsEnabled}
                onCheckedChange={(v) => patch('aiSuggestSessionsEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Organize</Label>
                <p className="text-xs text-muted-foreground">Reorganize all groups with AI</p>
              </div>
              <Switch
                checked={draft.aiOrganizeEnabled}
                onCheckedChange={(v) => patch('aiOrganizeEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Tab preview summaries</Label>
                <p className="text-xs text-muted-foreground">AI summary on tab hover preview</p>
              </div>
              <Switch
                checked={draft.aiTabSummaryEnabled}
                onCheckedChange={(v) => patch('aiTabSummaryEnabled', v)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Limit automatic AI suggestions to once a day</Label>
                <p className="text-xs text-muted-foreground">
                  The background suggest-sessions banner fires at most once per day to protect
                  your monthly AI quota. AI actions you trigger manually (Auto-group, Name group,
                  Organize) are never limited by this.
                </p>
              </div>
              <Switch
                checked={draft.aiDailyThrottle}
                onCheckedChange={(v) => patch('aiDailyThrottle', v)}
              />
            </div>
          </TabsContent>
        )}

        {(import.meta.env.DEV || import.meta.env.VITE_DEMO_BUILD === 'true') && (
          <TabsContent value="dev" className="space-y-4">
            {/* ponytail: hook for the Playwright/Remotion marketing demo pipeline — kept
                visible in demo builds too (not just DEV) since recording runs against one */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Demo Mode</Label>
                <p className="text-xs text-muted-foreground">Seed sample data for the marketing demo pipeline</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs shrink-0 rounded-none"
                onClick={() => void enterDemoMode()}
              >
                Enter
              </Button>
            </div>

            {import.meta.env.DEV && AI_ENABLED && (
              <>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Label className="text-sm">Mocked AI usage count</Label>
                    <p className="text-xs text-muted-foreground">
                      Sets the AI credit counter (out of {aiUsageCap}) locally and syncs it to your
                      real Supabase account, so server-side quota enforcement can be tested end-to-end.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Input
                      type="number"
                      min={0}
                      value={devUsageInput}
                      onChange={(e) => setDevUsageInput(e.target.value)}
                      className="w-16 h-8 text-xs rounded-none"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs rounded-none"
                      onClick={() => void handleSyncDevUsage(Number(devUsageInput) || 0)}
                    >
                      Set
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs rounded-none"
                      onClick={() => void handleSyncDevUsage(0)}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm">Sentry</Label>
                    <p className="text-xs text-muted-foreground">Throw a test error to verify reporting</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs shrink-0 rounded-none text-destructive hover:text-destructive"
                    onClick={() => {
                      throw new Error('Sentry test error — thrown from Settings > Dev (dev only)');
                    }}
                  >
                    Throw error
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        )}
        </div>
      </Tabs>

      {/* Footer — only shown for the General tab, which now owns the cloud sync toggle too */}
      {activeTab === 'general' && (
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
      )}
    </>
  );
}
