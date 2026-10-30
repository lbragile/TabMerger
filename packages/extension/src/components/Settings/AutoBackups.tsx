import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, t as translate } from '@/lib/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { AUTO_BACKUP_INTERVALS, AUTO_BACKUP_MESSAGE, AUTO_BACKUP_RETENTION_COUNT, normalizeAutoBackupInterval } from '@tabmerger/shared';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useAuth } from '@/hooks/useAuth';
import { useConfirm } from '@/hooks/useConfirm';
import { useGroups, useImportGroups, useReplaceSavedGroups } from '@/hooks/useGroups';
import { AutoBackupFileSettings, type BackupFilePatch } from '@/components/Settings/AutoBackupFileSettings';
import { useAppSettings, useSaveAppSettings, DEFAULT_APP_SETTINGS, type AppSettings } from '@/hooks/useAppSettings';
import { useSessions, SESSIONS_QUERY_KEY } from '@/hooks/useSessions';
import { deleteAutoBackup, describeAutoBackupOutcome, isAutoBackup, parseAutoBackupOutcome, readAutoBackupSettings } from '@/lib/autoBackup';
import { BACKUP_DOWNLOAD_MESSAGES, downloadAutoBackups, type BackupDownloadResult } from '@/lib/autoBackupDownload';
import { autoBackupDownloadQueryKey, backupFileStatusQueryKey } from '@/lib/autoBackupQueryKeys';
import { countSavedGroupsAndTabs } from '@/lib/tierLimits';
import { useUIStore } from '@/stores/uiStore';
import { importGroups, skippedContext } from '@/lib/importExport';
import { blockImportOverFreeLimit } from '@/lib/tierLimits';
import { cn, getGroupTabCount, relativeTimeStr } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
import { toast } from '@/lib/toast';
import type { Session } from '@/lib/types';
import { SETTINGS_SELECT_WIDTH } from '@/components/Settings/settingsControls';

type BackupSettingsPatch = Partial<Pick<AppSettings, 'autoBackupEnabled' | 'autoBackupIntervalMinutes'>> & BackupFilePatch;

interface AutoBackupsProps {
  /**
   * Called after one of the backup settings was saved. These controls save immediately (the
   * Settings footer with "Save changes" only exists on the General tab), so the modal patches its
   * draft with the same value: a later "Save changes" must not write the old one back.
   */
  onSettingsSaved: (patch: BackupSettingsPatch) => void;
  /** Called after a backup's groups were added back, so the modal can close and show them. */
  onRestored: () => void;
}

/**
 * The line under the controls about backups stored in the account, or `null` for nothing to say.
 * `paid` is false for a free or lapsed account: it is not told to set up encryption (it never
 * had cloud backups), only what applies to it.
 */
export function describeBackupDownload(result: BackupDownloadResult | undefined, loading: boolean, paid: boolean): string | null {
  if (loading) return translate('backups.download.checking');
  if (!result || result.status === 'busy') return null;
  if (result.status === 'blocked') {
    if (!paid && result.reason === 'no-key') return null;
    return BACKUP_DOWNLOAD_MESSAGES[result.reason];
  }
  const parts: string[] = [];
  if (result.added > 0) parts.push(translate('backups.download.broughtBack', { count: result.added }));
  if (result.unreadable > 0) {
    parts.push(translate('backups.download.unreadable'));
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

const formatBackupDate = (ms: number) =>
  formatDateTime(ms, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * Settings → Data → "Automatic backups". Paid accounts get the switch, the interval, "Back up
 * now" and the list; everyone else gets a short explanation and an upgrade button. Backups that
 * already exist stay listed (restore / delete) after a downgrade.
 *
 * This is only the UI of the rule: the worker checks the plan with the server before every
 * backup, and the server rejects the cloud copy for an account that is not paid.
 */
export function AutoBackups({ onSettingsSaved, onRestored }: AutoBackupsProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { cloudSync, maxGroups, maxTabs, loading: planLoading } = useEntitlements();
  const { data: saved, isLoading: settingsLoading } = useAppSettings();
  const { mutateAsync: saveAppSettings } = useSaveAppSettings();
  const { user, loading: authLoading } = useAuth();
  const { data: sessions = [] } = useSessions();
  // Deleting a backup also remembers its id until the server confirms, so a download cannot bring it back.
  const { mutate: deleteBackup } = useMutation({
    mutationFn: deleteAutoBackup,
    onSettled: () => qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY })
  });
  // Backups stored in the account are fetched when this section is shown (and again after "Back up
  // now"): never on a timer. It only adds missing backups; a failure changes nothing that is listed.
  const {
    data: download,
    isFetching: downloading,
    refetch: refetchDownload
  } = useQuery({
    queryKey: autoBackupDownloadQueryKey(user?.id),
    queryFn: async () => {
      const result = await downloadAutoBackups();
      // Refresh the list from HERE, not from an effect on this query's data: the key changes when
      // the signed-in user becomes known, and a result that arrived under the earlier key is
      // never the one rendered, so its additions would stay invisible until the popup reopened.
      if (result.status === 'done' && result.added > 0) await qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      return result;
    },
    // Not before sign-in state is known: started early it would run once as "nobody" and again
    // for the user, and the second (empty) result would replace the first one's message.
    enabled: !authLoading,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    // a backup run held the lock: look again shortly instead of showing nothing
    refetchInterval: (query) => (query.state.data?.status === 'busy' ? 2000 : false)
  });
  const { data: groupsState } = useGroups();
  const { mutate: importGroupsMutation } = useImportGroups();
  const { mutate: replaceGroupsMutation, isPending: replacing } = useReplaceSavedGroups();
  const { confirm, confirmDialog } = useConfirm();
  const [running, setRunning] = useState(false);
  /** The backup whose "how do you want it back" choice is open, if any. */
  const [restoreId, setRestoreId] = useState<string | null>(null);

  const { enabled, intervalMinutes, file } = readAutoBackupSettings(saved);
  const backups = sessions.filter(isAutoBackup); // newest first (getSessions sorts)

  // After a delete the removed row's button is gone: focus moves to the next row's Delete button,
  // else the previous one's, else the section. `null` = nothing pending.
  const sectionRef = useRef<HTMLElement>(null);
  const [focusAfterDelete, setFocusAfterDelete] = useState<{ deletedId: string; nextId: string | null } | null>(null);
  useEffect(() => {
    if (!focusAfterDelete || backups.some((b) => b.id === focusAfterDelete.deletedId)) return;
    const { nextId } = focusAfterDelete;
    setFocusAfterDelete(null);
    const buttons = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>('[data-backup-delete]') ?? []);
    const target = nextId ? buttons.find((el) => el.dataset.backupDelete === nextId) : undefined;
    (target ?? sectionRef.current)?.focus();
  }, [backups, focusAfterDelete]);
  const latest = backups[0];
  const downloadNote = describeBackupDownload(download, downloading && download?.status !== 'busy', cloudSync);

  // The worker writes backups while this panel may be open: refresh the list when it says so.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
    const onMessage = (msg: unknown) => {
      if ((msg as { type?: unknown } | null | undefined)?.type === AUTO_BACKUP_MESSAGE.COMPLETED) {
        void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        void qc.invalidateQueries({ queryKey: backupFileStatusQueryKey });
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, [qc]);

  const save = async (patch: BackupSettingsPatch) => {
    // Never write defaults over settings that have not been read yet.
    if (settingsLoading) return;
    try {
      await saveAppSettings({ ...(saved ?? DEFAULT_APP_SETTINGS), ...patch });
      onSettingsSaved(patch);
    } catch {
      toast.error(t('backups.toast.settingFailed'));
    }
  };

  const handleBackupNow = async () => {
    setRunning(true);
    try {
      const reply: unknown = await chrome.runtime.sendMessage({ type: AUTO_BACKUP_MESSAGE.RUN_NOW });
      const outcome = parseAutoBackupOutcome(reply);
      const { ok, message } = describeAutoBackupOutcome(outcome);
      if (ok) {
        toast.success(message);
        void refetchDownload();
      }
      else if (outcome?.status === 'skipped') toast.info(message);
      else toast.error(message);
    } catch {
      toast.error(describeAutoBackupOutcome(null).message);
    } finally {
      setRunning(false);
      void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: backupFileStatusQueryKey });
    }
  };

  // Restoring a backup puts its groups back into TabMerger. It does not open or close any browser
  // window (that is what restoring a SESSION does). The user picks how:
  //  - "add": next to the current groups, nothing is replaced;
  //  - "replace": the saved groups become exactly the backup's ("put it back the way it was"),
  //    after a confirmation. "Now Open" is never touched.
  // Both go through the import path: the stored snapshot is validated and rebuilt like a file
  // would be, every group gets a new id and is marked for sync, and both can be undone.
  const handleRestore = async (backup: Session, mode: 'add' | 'replace') => {
    let parsed: ReturnType<typeof importGroups>;
    try {
      parsed = importGroups(JSON.stringify(backup.groups));
    } catch {
      toast.error(t('backups.toast.unreadable'));
      return;
    }
    const { groups, skipped } = parsed;
    if (groups.length === 0) {
      toast.error(t('backups.toast.noGroups'));
      return;
    }
    if (blockImportOverFreeLimit({ maxGroups, maxTabs }, groupsState?.available ?? [], groups, mode === 'add' ? 'append' : 'replace')) return;
    const backupGroups = t('common.groupCount', { count: groups.length });
    const done = {
      onSuccess: () => {
        trackEvent('auto_backup_restored', { mode });
        toast.success(t('backups.toast.restored', { backup: backupGroups, ...skippedContext(skipped) }));
        setRestoreId(null);
        onRestored();
      },
      onError: () => toast.error(t('backups.toast.restoreFailed'))
    };
    if (mode === 'add') {
      importGroupsMutation(groups, done);
      return;
    }
    const current = countSavedGroupsAndTabs(groupsState?.available ?? []).groups;
    // a replace that is still being written must not be started a second time
    if (replacing) return;
    const confirmed = await confirm({
      title: t('backups.replaceTitle'),
      description: current === 0
        ? t('backups.replaceDescription', { backup: backupGroups })
        : t('backups.replaceDescriptionLosing', { backup: backupGroups, count: current }),
      confirmLabel: t('backups.replaceConfirm'),
      destructive: true
    });
    if (!confirmed) return;
    replaceGroupsMutation(groups, {
      ...done,
      onSuccess: () => {
        // the list is a different one now: show its first group
        useUIStore.getState().setActiveGroupIndex(0);
        done.onSuccess();
      }
    });
  };

  const handleDelete = async (backup: Session) => {
    const confirmed = await confirm({
      title: t('backups.deleteTitle'),
      description: t('backups.deleteDescription', { when: formatBackupDate(backup.createdAt), scope: t('backups.deleteScope') }),
      confirmLabel: t('backups.deleteConfirm'),
      destructive: true
    });
    if (!confirmed) return;
    const at = backups.findIndex((b) => b.id === backup.id);
    const neighbor = backups[at + 1] ?? backups[at - 1];
    setFocusAfterDelete({ deletedId: backup.id, nextId: neighbor?.id ?? null });
    deleteBackup(backup.id);
  };

  return (
    <section ref={sectionRef} tabIndex={-1} aria-label={t('backups.title')} className="min-w-0 space-y-3 focus:outline-none">
      {planLoading ? (
        // The plan is not known yet: neither the controls nor the upgrade offer (a paid user must
        // not see "Upgrade to Pro" flash by while their subscription loads).
        <div className="min-w-0">
          <Label className="text-sm">{t('backups.title')}</Label>
          <p className="text-xs text-muted-foreground">{t('backups.checkingPlan')}</p>
        </div>
      ) : cloudSync ? (
        <>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('backups.title')}</Label>
              <p className="text-xs text-muted-foreground">{t('backups.description', { count: AUTO_BACKUP_RETENTION_COUNT })}</p>
            </div>
            <Switch
              className="shrink-0"
              aria-label={t('backups.title')}
              checked={enabled}
              disabled={settingsLoading}
              onCheckedChange={(v) => void save({ autoBackupEnabled: v === true })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <Label className="text-sm">{t('backups.intervalLabel')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('backups.intervalDescription', { count: AUTO_BACKUP_RETENTION_COUNT })}
              </p>
            </div>
            <Select
              value={String(intervalMinutes)}
              disabled={!enabled || settingsLoading}
              onValueChange={(v) => void save({ autoBackupIntervalMinutes: normalizeAutoBackupInterval(Number(v)) })}
            >
              <SelectTrigger className={`${SETTINGS_SELECT_WIDTH} h-7 text-xs shrink-0`} aria-label={t('backups.intervalAria')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTO_BACKUP_INTERVALS.map((option) => (
                  <SelectItem key={option.minutes} value={String(option.minutes)}>
                    {t(`backups.interval.${option.minutes}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {latest ? t('backups.lastBackup', { when: relativeTimeStr(latest.createdAt) }) : t('backups.noBackupYet')}
            </p>
            <Button
              variant="outline"
              size="sm"
              // `aria-disabled`, not `disabled`: a disabled button drops keyboard focus to the
              // page while the backup runs. The handler is guarded instead.
              className="text-xs shrink-0 rounded-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
              aria-disabled={running || downloading}
              aria-busy={running}
              onClick={() => {
                if (running || downloading) return;
                void handleBackupNow();
              }}
            >
              {running ? t('backups.backingUp') : t('backups.backUpNow')}
            </Button>
          </div>

          <AutoBackupFileSettings file={file} disabled={settingsLoading} onSave={save} />
        </>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Label className="text-sm">{t('backups.title')}</Label>
            <p className="text-xs text-muted-foreground">{t('backups.upgradeDescription', { count: AUTO_BACKUP_RETENTION_COUNT })}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="text-xs shrink-0 rounded-none"
            onClick={() => {
              trackEvent('upgrade_clicked', { source: 'settings_auto_backup' });
              chrome.tabs.create({ url: `${import.meta.env.VITE_WEB_APP_URL}/pricing`, active: true });
            }}
          >
            {t('backups.upgradeToPro')}
          </Button>
        </div>
      )}

      {/* Always in the DOM, only its text changes: a status element that is mounted together
          with its text is often not announced. While empty it takes no room: `-mt-3` cancels the
          gap above it, and `flow-root` stops its own margins from collapsing through it, so the
          spacing of the rows around it is the same as when it was not rendered. */}
      <p className={cn('min-w-0 text-xs text-muted-foreground', !downloadNote && '-mt-3 flow-root')} role="status">
        {downloadNote ?? ''}
      </p>

      {!cloudSync && backups.length > 0 && (
        <p className="min-w-0 text-xs text-muted-foreground">
          {t('backups.planEnded')}
        </p>
      )}

      {backups.length > 0 && (
        <ul className="min-w-0 border border-border divide-y divide-border" aria-label={t('backups.listLabel')}>
          {backups.map((backup) => {
            const tabCount = backup.groups.reduce((sum, g) => sum + getGroupTabCount(g), 0);
            const when = formatBackupDate(backup.createdAt);
            return (
              <li key={backup.id} className="min-w-0 px-2 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-xs">{when}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {t('backups.counts', { groups: t('common.groupCount', { count: backup.groups.length }), tabs: t('common.tabCount', { count: tabCount }) })}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs shrink-0 rounded-none"
                  aria-label={t('backups.restoreFrom', { when })}
                  aria-expanded={restoreId === backup.id}
                  onClick={() => setRestoreId(restoreId === backup.id ? null : backup.id)}
                >
                  <RotateCcw className="h-3 w-3" />
                  {t('backups.restore')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 shrink-0 rounded-none text-muted-foreground hover:text-destructive"
                  aria-label={t('backups.deleteFrom', { when })}
                  data-backup-delete={backup.id}
                  onClick={() => void handleDelete(backup)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                </div>
                {restoreId === backup.id && (
                  <div className="mt-1.5 min-w-0 space-y-1.5" role="group" aria-label={t('backups.howToRestore', { when })}>
                    <p className="text-[11px] text-muted-foreground">
                      {t('backups.restoreExplainer')}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <Button variant="outline" size="sm" className="h-7 text-xs rounded-none" onClick={() => void handleRestore(backup, 'add')}>
                        {t('backups.addToMine')}
                      </Button>
                      <Button variant="outline" size="sm" className="h-7 text-xs rounded-none" onClick={() => void handleRestore(backup, 'replace')}>
                        {t('backups.replaceMine')}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs rounded-none" onClick={() => setRestoreId(null)}>
                        {t('backups.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
