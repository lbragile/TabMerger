import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { applyTheme } from '@/lib/theme';
import { TOUR_ANCHORS } from '@/lib/tourSteps';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAuth } from '@/hooks/useAuth';
import { useConfirm } from '@/hooks/useConfirm';
import { useGroups, useImportGroups } from '@/hooks/useGroups';
import { useAppSettings, useSaveAppSettings, DEFAULT_APP_SETTINGS, type AppSettings } from '@/hooks/useAppSettings';
import { useAiUsage } from '@/hooks/useAiUsage';
import { importGroups, parseBookmarksHtml, parseOneTabs, skippedContext } from '@/lib/importExport';
import { exportGroups } from '@/lib/importExport';
import { enterDemoMode } from '@/lib/demo';
import { OtherDevices } from '@/components/Settings/OtherDevices';
import { AutoBackups } from '@/components/Settings/AutoBackups';
import { CheckForUpdates } from '@/components/Settings/CheckForUpdates';
import { LanguageSetting } from '@/components/Settings/LanguageSetting';
import { AiSettings } from '@/components/Settings/AiSettings';
import { useLanguageSetting } from '@/hooks/useLocalePreference';
import { autoBackupDownloadQueryKey } from '@/lib/autoBackupQueryKeys';
import type { BackupDownloadResult } from '@/lib/autoBackupDownload';
import { toast } from '@/lib/toast';
import { Download, Upload } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { trackEvent } from '@/lib/analytics';
import { getEncryptionKeyState, resetEncryption } from '@/lib/encryptionKey';
import { AI_ENABLED, AI_MANAGED_ENABLED } from '@/lib/aiFlag';
import { DevAiCredits } from '@/components/Settings/DevAiCredits';
import { blockImportOverFreeLimit } from '@/lib/tierLimits';
import { requestDataConsent } from '@/lib/dataConsent';
import { PREVIEW_IMAGES_DATA_CONSENT_CATEGORIES, PRICING_TIERS, SEARCH_NON_MATCHING, formatUsd, normalizeSearchNonMatching, toHttpUrl } from '@tabmerger/shared';
import { formatDate } from '@/lib/i18n';

/** The search setting's options, in the order the select lists them. */
const SEARCH_NON_MATCHING_CHOICES = [
  { value: SEARCH_NON_MATCHING.HIDE, label: 'search.hide' },
  { value: SEARCH_NON_MATCHING.DIM, label: 'search.dim' },
] as const;

const STALE_THRESHOLD_DAYS = [7, 14, 30, 60] as const;

function settingsEqual(a: AppSettings, b: AppSettings) {
  // A key that settings saved by an older version lack counts as its default, so a newer
  // setting does not make an untouched form look edited.
  return (Object.keys(a) as (keyof AppSettings)[]).every((k) => (a[k] ?? DEFAULT_APP_SETTINGS[k]) === (b[k] ?? DEFAULT_APP_SETTINGS[k]));
}

/** The tabs a caller may open Settings on (`openModal('settings', { tab })`). */
const SETTINGS_TABS = ['general', 'account', 'data', 'devices', 'ai', 'dev'] as const;

interface SettingsModalProps {
  onClose: () => void;
  /** The tab to open on, e.g. `ai` from an "Open Settings" action on an AI error. Unknown values open General. */
  initialTab?: unknown;
}

export function SettingsModal({ onClose, initialTab }: SettingsModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>(() =>
    (SETTINGS_TABS as readonly unknown[]).includes(initialTab) ? (initialTab as string) : 'general'
  );
  // The requested tab until it has been shown. The AI and Devices tabs exist only once the
  // account has loaded (useAuth reads the session after mount), and until then the dialog's
  // open focus lands on the tab list, where Radix's focus activation selects General.
  const requestedTab = useRef<string | null>(activeTab === 'general' ? null : activeTab);
  const tabListRef = useRef<HTMLDivElement>(null);
  const [focusActiveTab, setFocusActiveTab] = useState(false);
  const queryClient = useQueryClient();
  // `saved` is the query's current value (reactive — reflects saves made elsewhere,
  // e.g. another mount of this modal, and refetches after login via useSync's invalidate).
  const { data: saved = DEFAULT_APP_SETTINGS } = useAppSettings();
  const { mutateAsync: saveAppSettings } = useSaveAppSettings();
  const [draft, setDraft] = useState<AppSettings>(saved);
  // Per-device, not an AppSetting: saved and applied with the rest by "Save changes"
  const language = useLanguageSetting();
  const { tier, cloudSync, currentPeriodEnd, aiFeatures, aiMode, maxGroups, maxTabs } = useEntitlements();
  const { remaining: aiUsageRemaining, cap: aiUsageCap, loading: aiUsageLoading } = useAiUsage();
  const { user, session, signOut } = useAuth();

  // Shows the requested tab once it exists (see `requestedTab`), once: later picks are the user's
  useEffect(() => {
    const tab = requestedTab.current;
    if (!tab) return;
    if ((tab === 'ai' && !aiFeatures) || (tab === 'devices' && tier === 'free')) return;
    requestedTab.current = null;
    setActiveTab(tab);
    // Focus follows only when it sits on the tab list (the dialog's open focus), never from elsewhere
    if (tabListRef.current?.contains(document.activeElement)) setFocusActiveTab(true);
  }, [aiFeatures, tier]);

  useEffect(() => {
    if (!focusActiveTab) return;
    setFocusActiveTab(false);
    tabListRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
  }, [focusActiveTab]);
  const [portalLoading, setPortalLoading] = useState(false);
  const { data: groupsState } = useGroups();
  const { mutate: importGroupsMutation } = useImportGroups();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const { confirm, confirmDialog } = useConfirm();
  const openModal = useUIStore((s) => s.openModal);
  const syncPausedReason = useUIStore((s) => s.syncPausedReason);
  const startTour = useUIStore((s) => s.startTour);
  // The tour is only drawn while no modal is open, so Settings closes first
  const handleStartTour = () => {
    trackEvent('tour_started', { source: 'settings' });
    onClose();
    startTour();
  };
  const [canResetEncryption, setCanResetEncryption] = useState(false);

  useEffect(() => {
    if (!user) return;
    void getEncryptionKeyState().then((state) => setCanResetEncryption(state === 'present'));
  }, [user]);

  const handleResetEncryption = () => {
    openModal('resetEncryption', {
      onConfirm: () => {
        void resetEncryption()
          .then(() => {
            toast.success(t('settings.toast.encryptionReset'));
            openModal('encryptionSetup');
          })
          .catch((e) => toast.error(e instanceof Error ? e.message : t('settings.toast.encryptionResetFailed')));
      }
    });
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

  const isDirty = !settingsEqual(draft, saved) || language.isDirty;

  // upgrade_prompt_shown pairs with the upgrade_clicked fired below — fire once per mount when the CTA is visible
  useEffect(() => {
    if (!cloudSync) trackEvent('upgrade_prompt_shown', { source: 'settings' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  // Turning the toggle ON must request Firefox's browsingActivity permission FIRST — as the
  // very first statement, no prior `await` — before flipping the setting on. Turning it off
  // never needs consent. No-op on Chrome/Edge (requestDataConsent always resolves true there).
  const handlePreviewImagesToggle = async (checked: boolean) => {
    if (checked) {
      const granted = await requestDataConsent(PREVIEW_IMAGES_DATA_CONSENT_CATEGORIES);
      if (!granted) {
        toast.error(t('settings.toast.previewImagesDenied'));
        return;
      }
    }
    patch('showPreviewImages', checked);
  };

  const handleSave = async () => {
    if (draft.syncEnabled && !saved.syncEnabled) trackEvent('sync_enabled');
    await saveAppSettings(draft);
    applyTheme(draft.theme);
    await language.save();
    toast.success(t('settings.toast.saved'));
  };

  const handleRestoreDefaults = () => {
    setDraft(DEFAULT_APP_SETTINGS);
    language.reset();
  };

  const performClearAll = async () => {
    // one QUEUED wipe: raw store clears raced in-flight groups writes, which could re-populate the store
    await import('@/lib/localDb').then((m) => m.clearAllLocalData());
    useUIStore.getState().clearHistory(); // snapshots of the wiped data must not be restorable
    toast.success(t('settings.toast.cleared'));
    onClose();
  };

  const handleClearAll = () => {
    // Only when this panel has just SEEN automatic backups in the signed-in account (the Data tab's
    // backups section downloaded them) does the confirmation say they are kept: clearing wipes this
    // device only, and they can be brought back from here afterwards. No cloud copy, no sentence.
    const download = queryClient.getQueryData<BackupDownloadResult>(autoBackupDownloadQueryKey(user?.id));
    const cloudBackupsKept = !!user && download?.status === 'done' && download.inAccount > 0;
    openModal('clearAllData', { onConfirm: () => void performClearAll(), ...(cloudBackupsKept ? { cloudBackupsKept: true } : {}) });
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
    toast.success(t('importExport.toast.exported'));
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop()?.toLowerCase();
      // Every parser validates what it reads and reports how many entries it left out
      const parse = ext === 'html' ? parseBookmarksHtml : ext === 'txt' ? parseOneTabs : importGroups;
      const { groups, skipped } = parse(text);
      if (groups.length === 0) throw new Error(t('settings.toast.noGroupsFound'));

      // Free-tier backstop: this import path is additive (appends to existing groups),
      // so gate on current + imported, same as ImportExport.tsx's Bookmarks/OneTab paths.
      if (blockImportOverFreeLimit({ maxGroups, maxTabs }, groupsState?.available ?? [], groups, 'append')) return;

      // The file name is the user's own, shown as text and cut short so it cannot fill the dialog.
      const from = file.name.length > 60 ? `${file.name.slice(0, 60)}…` : file.name;
      const confirmed = await confirm({
        title: t('settings.data.importTitle', { count: groups.length }),
        description: t('settings.data.importDescription', { count: groups.length, file: from }),
        confirmLabel: t('settings.data.importConfirm', { count: groups.length }),
        // the file picker took focus away: give it back to the Import button
        returnFocusTo: importButtonRef.current
      });
      if (!confirmed) return;
      importGroupsMutation(groups, {
        onSuccess: () => {
          toast.success(t('importExport.toast.imported', skippedContext(skipped)));
          onClose();
        }
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.toast.invalidFile'));
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
      // The billing portal is always an http(s) page; anything else in the response is not opened
      const portalUrl = toHttpUrl(url);
      if (error || !portalUrl) throw new Error(error ?? 'No portal URL');
      chrome.tabs.create({ url: portalUrl, active: true });
    } catch {
      toast.error(t('settings.toast.portalFailed'));
    } finally {
      setPortalLoading(false);
    }
  };

  // Built from PRICING_TIERS, so a price change can't leave this label stale: "Pro (US$3.99/mo)".
  // US$ because nothing here says the price is in US dollars (see formatUsd).
  const tierLabels: Record<string, string> = Object.fromEntries(
    PRICING_TIERS.map((plan) => {
      const name = plan.id === 'pro_ai' ? t('common.tier.proAi') : plan.id === 'pro' ? t('common.tier.pro') : t('settings.account.planFree');
      return [plan.id, plan.monthlyPrice > 0 ? t('settings.account.planWithPrice', { name, price: formatUsd(plan.monthlyPrice) }) : name];
    })
  );

  // __TABMERGER_VERSION__ is a Vite `define` (src/env.d.ts) carrying the same raw semver string
  // fed into scripts/manifestVersion.ts's beta offset mapping — the real version testers should
  // report (e.g. "3.1.0-beta.5"), independent of the manifest's version/version_name split. Using
  // it directly (rather than reading chrome.runtime.getManifest().version_name) works identically
  // on every browser: Chrome/Edge get version_name for free, but Firefox drops that Chrome-only
  // manifest field entirely, so reading it there would show the offset store version instead
  // (e.g. "4.1.0.6"). Guard for test/dev environments where chrome.runtime may not exist.
  const hasExtensionManifest = typeof chrome !== 'undefined' && typeof chrome.runtime?.getManifest === 'function';
  const extensionVersion = hasExtensionManifest ? __TABMERGER_VERSION__ : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{t('settings.title')}</span>
          {extensionVersion && (
            <Badge className="shrink-0 select-text whitespace-nowrap text-[10px] font-normal">
              {t('settings.version', { version: extensionVersion })}
            </Badge>
          )}
        </DialogTitle>
      </DialogHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 min-w-0">
        <TabsList ref={tabListRef} className="w-full">
          <TabsTrigger value="general" className="flex-1 text-xs">
            {t('settings.tabs.general')}
          </TabsTrigger>
          <TabsTrigger value="account" className="flex-1 text-xs">
            {t('settings.tabs.account')}
          </TabsTrigger>
          <TabsTrigger value="data" className="flex-1 text-xs">
            {t('settings.tabs.data')}
          </TabsTrigger>
          {tier !== 'free' && (
            <TabsTrigger value="devices" className="flex-1 text-xs">
              {t('settings.tabs.devices')}
            </TabsTrigger>
          )}
          {aiFeatures && (
            <TabsTrigger value="ai" className="flex-1 text-xs">
              {t('settings.tabs.ai')}
            </TabsTrigger>
          )}
          {(import.meta.env.DEV || import.meta.env.VITE_DEMO_BUILD === 'true') && (
            <TabsTrigger value="dev" className="flex-1 text-xs">
              {t('settings.tabs.dev')}
            </TabsTrigger>
          )}
        </TabsList>

        {/* -ms-1 ps-1: the scroll clip sits 0.25rem outside the content on the start side too (pe-1
            on the end side), so a field flush with the content's edge keeps its focus ring there */}
        <div className="mt-4 -ms-1 max-h-[320px] min-w-0 overflow-y-auto overflow-x-hidden ps-1 pe-1">
        <TabsContent value="general" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.tourLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.general.tourDescription')}</p>
            </div>
            <Button variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={handleStartTour} aria-label={t('settings.general.tourButtonLabel')}>
              {t('settings.general.tourButton')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4" data-tour={TOUR_ANCHORS.settingsTheme}>
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.themeLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.general.themeDescription')}</p>
            </div>
            <Select
              value={draft.theme}
              onValueChange={(v) => patch('theme', v as AppSettings['theme'])}
            >
              <SelectTrigger className="w-28 h-7 text-xs shrink-0" aria-label={t('settings.general.themeLabel')} data-tour={TOUR_ANCHORS.settingsThemeTrigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t('settings.general.themeLight')}</SelectItem>
                <SelectItem value="dark">{t('settings.general.themeDark')}</SelectItem>
                <SelectItem value="system">{t('settings.general.themeSystem')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <LanguageSetting value={language.draft} onChange={language.setDraft} />

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.confirmDeleteLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.general.confirmDeleteDescription')}</p>
            </div>
            <Switch
              className="shrink-0"
              aria-label={t('settings.general.confirmDeleteLabel')}
              checked={draft.confirmOnDelete}
              onCheckedChange={(v) => patch('confirmOnDelete', v)}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.openOnClickLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.general.openOnClickDescription')}</p>
            </div>
            <Switch
              className="shrink-0"
              aria-label={t('settings.general.openOnClickLabel')}
              checked={draft.openTabOnClick}
              onCheckedChange={(v) => patch('openTabOnClick', v)}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('search.settingLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('search.settingDescription')}</p>
            </div>
            <Select
              // A stored value is only trusted when it is one of the options (older saves have none).
              value={normalizeSearchNonMatching(draft.searchNonMatching)}
              onValueChange={(v) => patch('searchNonMatching', normalizeSearchNonMatching(v))}
            >
              <SelectTrigger className="w-24 h-7 text-xs shrink-0" aria-label={t('search.settingLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEARCH_NON_MATCHING_CHOICES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{t(option.label)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.dedupLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.general.dedupDescription')}</p>
            </div>
            <Switch
              className="shrink-0"
              aria-label={t('settings.general.dedupLabel')}
              checked={draft.autoDedupOnMerge}
              onCheckedChange={(v) => patch('autoDedupOnMerge', v)}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.previewImagesLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.general.previewImagesDescription')}{' '}
                <a
                  href={`${import.meta.env.VITE_WEB_APP_URL ?? ''}/privacy#page-previews`}
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    chrome.tabs.create({
                      url: `${import.meta.env.VITE_WEB_APP_URL ?? ''}/privacy#page-previews`,
                      active: true
                    });
                  }}
                >
                  {t('settings.general.privacyPolicy')}
                </a>
              </p>
            </div>
            <Switch
              className="shrink-0"
              aria-label={t('settings.general.previewImagesLabel')}
              checked={draft.showPreviewImages}
              onCheckedChange={(v) => void handlePreviewImagesToggle(v)}
            />
          </div>

          {cloudSync && (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.general.cloudSyncLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.general.cloudSyncDescription')}</p>
                {/* The stored reason is the message in the language of when sync paused: shown from
                    the catalog, so a language switched since then shows here too */}
                {syncPausedReason && (
                  <p className="text-xs text-amber-500 mt-0.5">{t('errors.syncPaused')}</p>
                )}
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.general.cloudSyncLabel')}
                checked={draft.syncEnabled}
                onCheckedChange={(v) => patch('syncEnabled', v)}
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.staleLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.general.staleDescription')}</p>
            </div>
            <Select
              value={String(draft.staleThresholdDays ?? 30)}
              onValueChange={(v) => patch('staleThresholdDays', Number(v) as AppSettings['staleThresholdDays'])}
            >
              <SelectTrigger className="w-24 h-7 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STALE_THRESHOLD_DAYS.map((days) => (
                  <SelectItem key={days} value={String(days)}>{t('settings.general.staleDays', { count: days })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.general.urlRulesLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('settings.general.urlRulesDescription')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs shrink-0 rounded-none"
              onClick={() => openModal('urlRules')}
            >
              {t('settings.general.urlRulesButton')}
            </Button>
          </div>

          <CheckForUpdates />

          {/* For every plan (Settings → AI is Pro AI only): free and Pro see the button as a locked preview */}
          {AI_ENABLED && (
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.general.showAiButtonLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.general.showAiButtonDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.general.showAiButtonLabel')}
                // Settings saved before this existed lack it: on
                checked={draft.showAiButton !== false}
                onCheckedChange={(v) => patch('showAiButton', v)}
                data-testid="settings-show-ai-button"
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="account" className="space-y-4">
          <div className="border border-border p-3 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{t('settings.account.plan')}</span>
              <span className="text-xs font-medium">{tierLabels[tier] ?? t('settings.account.planFree')}</span>
            </div>
            {tier !== 'free' && currentPeriodEnd && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('settings.account.renews')}</span>
                <span className="text-xs font-medium">
                  {formatDate(currentPeriodEnd, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>
            )}
            {user && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('settings.account.email')}</span>
                <span className="text-xs">{user.email}</span>
              </div>
            )}
            {aiFeatures && aiMode !== 'byok' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('settings.account.aiCreditsLeft')}</span>
                <span className="text-xs font-medium">
                  {aiUsageLoading ? '…' : t('settings.account.aiCreditsValue', { remaining: aiUsageRemaining, cap: aiUsageCap })}
                </span>
              </div>
            )}
            {aiFeatures && aiMode === 'byok' && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('settings.account.aiKeyLabel')}</span>
                <span className="text-xs font-medium">{t('settings.account.aiOwnKey')}</span>
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
              {t('settings.account.upgradeToPro')}
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
              {portalLoading ? t('settings.account.openingPortal') : t('settings.account.manageBilling')}
            </Button>
          )}

          {user && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              className="w-full text-xs rounded-none hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
            >
              {t('settings.account.signOut')}
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
                {t('settings.account.resetEncryption')}
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="data" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('settings.data.intro')}
          </p>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.data.exportLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.data.exportDescription')}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 shrink-0 rounded-none"
              onClick={handleExport}
            >
              <Download className="h-3.5 w-3.5" />
              {t('settings.data.exportButton')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('settings.data.importLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.data.importDescription')}</p>
            </div>
            <Button
              ref={importButtonRef}
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 shrink-0 rounded-none"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('settings.data.importButton')}
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.html,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // cleared so that choosing the same file again (after Cancel) asks again
              e.target.value = '';
              if (file) void handleImport(file);
            }}
          />

          <Separator />

          {/* Saves its two settings immediately (this tab has no Save footer) and mirrors them
              into the draft, so a later "Save changes" on General cannot write old values back. */}
          <AutoBackups
            onSettingsSaved={(saved) => setDraft((prev) => ({ ...prev, ...saved }))}
            onRestored={onClose}
          />

          <Separator />

          <Button variant="destructive" size="sm" className="w-full text-xs rounded-none" onClick={handleClearAll}>
            {t('settings.data.clearAll')}
          </Button>
        </TabsContent>

        {tier !== 'free' && (
          <TabsContent value="devices" className="space-y-4">
            <OtherDevices />
          </TabsContent>
        )}

        {aiFeatures && (
          <TabsContent value="ai" className="space-y-4">
            <AiSettings model={draft.aiModel} onModelChange={(v) => patch('aiModel', v)} />
            {aiMode !== 'byok' && (
              <p className="text-xs text-muted-foreground">
                {t('settings.ai.intro')}
              </p>
            )}

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.autoGroupLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.ai.autoGroupDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.autoGroupLabel')}
                checked={draft.aiAutoGroupEnabled}
                onCheckedChange={(v) => patch('aiAutoGroupEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.nameGroupLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.ai.nameGroupDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.nameGroupLabel')}
                checked={draft.aiNameGroupEnabled}
                onCheckedChange={(v) => patch('aiNameGroupEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.describeGroupLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.ai.describeGroupDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.describeGroupLabel')}
                // Settings saved before this toggle existed lack it: on
                checked={draft.aiDescribeGroupEnabled !== false}
                onCheckedChange={(v) => patch('aiDescribeGroupEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.suggestSessionsLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.ai.suggestSessionsDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.suggestSessionsLabel')}
                checked={draft.aiSuggestSessionsEnabled}
                onCheckedChange={(v) => patch('aiSuggestSessionsEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.organizeLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.ai.organizeDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.organizeLabel')}
                checked={draft.aiOrganizeEnabled}
                onCheckedChange={(v) => patch('aiOrganizeEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.summariesLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.ai.summariesDescription')}</p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.summariesLabel')}
                checked={draft.aiTabSummaryEnabled}
                onCheckedChange={(v) => patch('aiTabSummaryEnabled', v)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.ai.throttleLabel')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('settings.ai.throttleDescription')}
                </p>
              </div>
              <Switch
                className="shrink-0"
                aria-label={t('settings.ai.throttleLabel')}
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
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Label className="text-sm">{t('settings.dev.demoLabel')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.dev.demoDescription')}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs shrink-0 rounded-none"
                onClick={() => void enterDemoMode()}
              >
                {t('settings.dev.demoButton')}
              </Button>
            </div>

            {/* Credits exist only on TabMerger's key, so only while that option is live */}
            {import.meta.env.DEV && AI_MANAGED_ENABLED && (
              <>
                <Separator />
                <DevAiCredits cap={aiUsageCap} />
              </>
            )}

            {import.meta.env.DEV && AI_ENABLED && (
              <>
                <Separator />
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Label className="text-sm">{t('settings.dev.sentryLabel')}</Label>
                    <p className="text-xs text-muted-foreground">{t('settings.dev.sentryDescription')}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs shrink-0 rounded-none text-destructive hover:text-destructive"
                    onClick={() => {
                      throw new Error('Sentry test error — thrown from Settings > Dev (dev only)');
                    }}
                  >
                    {t('settings.dev.sentryButton')}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        )}
        </div>
      </Tabs>

      {/* Footer — shown for the tabs whose controls edit the draft: General (which owns the cloud
          sync toggle too) and AI (feature toggles and the model) */}
      {(activeTab === 'general' || activeTab === 'ai') && (
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground shrink-0"
            onClick={handleRestoreDefaults}
          >
            {t('settings.general.restoreDefaults')}
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            {isDirty && (
              <span className="text-xs text-muted-foreground shrink-0">{t('settings.general.unsavedChanges')}</span>
            )}
            <Button
              size="sm"
              className="text-xs shrink-0"
              disabled={!isDirty}
              onClick={() => void handleSave()}
              data-tour={TOUR_ANCHORS.settingsSaveButton}
            >
              {t('settings.general.saveChanges')}
            </Button>
          </div>
        </div>
      )}
      {confirmDialog}
    </>
  );
}
