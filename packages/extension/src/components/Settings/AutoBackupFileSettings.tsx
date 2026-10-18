import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatList } from '@/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import {
  BACKUP_FILE_EXTENSION,
  BACKUP_FILE_PERMISSION,
  BACKUP_FILE_TOKENS,
  DEFAULT_BACKUP_FILE_FOLDER,
  DEFAULT_BACKUP_FILE_PATTERN,
  buildBackupFilePath,
  validateBackupFilePattern,
  validateBackupFolder
} from '@tabmerger/shared';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AppSettings } from '@/hooks/useAppSettings';
import { describeBackupFile, type AutoBackupSettings } from '@/lib/autoBackup';
import {
  canShowBackupFolder,
  hasBackupFilePermission,
  locateBackupFile,
  parseBackupFileLast,
  parseBackupFileStatus,
  showBackupFile
} from '@/lib/autoBackupFile';
import { backupFileLastQueryKey, backupFilePermissionQueryKey, backupFileStatusQueryKey } from '@/lib/autoBackupQueryKeys';
import { getSetting } from '@/lib/localDb';
import { AUTO_BACKUP_FILE_LAST_KEY, AUTO_BACKUP_FILE_STATUS_KEY } from '@/lib/syncSettingKeys';
import { relativeTimeStr } from '@/lib/utils';
import { toast } from '@/lib/toast';

export type BackupFilePatch = Partial<Pick<AppSettings, 'autoBackupFileEnabled' | 'autoBackupFileFolder' | 'autoBackupFilePattern'>>;

interface AutoBackupFileSettingsProps {
  /** The saved, already validated values (see readAutoBackupSettings). */
  file: AutoBackupSettings['file'];
  /** Automatic backups are off or settings are still loading: nothing here can be changed. */
  disabled: boolean;
  onSave: (patch: BackupFilePatch) => Promise<void> | void;
}

const formatFileTime = (ms: number) =>
  formatDateTime(ms, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** What the preview is built from: a fixed example, so it does not jump around while typing. */
const PREVIEW = { groups: 4, tabs: 37 };

/**
 * "Also save a file to this computer" inside Settings → Data → Automatic backups.
 *
 * The folder and file name the user types become a path on their disk. They are checked on every
 * keystroke with the shared validators, saved only when valid, and the background worker checks
 * the stored values again before it writes (it never trusts what this component saved).
 */
export function AutoBackupFileSettings({ file, disabled, onSave }: AutoBackupFileSettingsProps) {
  const { t } = useTranslation();
  const folderId = useId();
  const patternId = useId();
  const lastFileId = useId();
  const [folder, setFolder] = useState(file.folder);
  const [pattern, setPattern] = useState(file.pattern);
  const [previewAt] = useState(() => Date.now());

  // The saved value changed elsewhere (reset, another popup): show it.
  useEffect(() => setFolder(file.folder), [file.folder]);
  useEffect(() => setPattern(file.pattern), [file.pattern]);

  // The permission can be taken away in the browser's extension settings at any time, so the
  // switch shows what is actually possible, not only what was saved.
  const { data: permitted, refetch: recheckPermission } = useQuery({
    queryKey: backupFilePermissionQueryKey,
    queryFn: hasBackupFilePermission,
    staleTime: 0,
    refetchOnWindowFocus: true
  });
  const { data: status } = useQuery({
    queryKey: backupFileStatusQueryKey,
    queryFn: async () => parseBackupFileStatus(await getSetting<unknown>(AUTO_BACKUP_FILE_STATUS_KEY, null)),
    staleTime: 0
  });

  const on = file.enabled && permitted === true;
  const revoked = file.enabled && permitted === false;

  // Where the last file is NOW: the browser is asked each time this is shown, after every backup
  // (the status above changes), and when the popup gets focus back (the user may have moved the
  // file in the file manager that "Show in folder" opened).
  const { data: location, refetch: recheckLocation } = useQuery({
    queryKey: [...backupFileLastQueryKey, status?.at ?? 0],
    queryFn: async () => locateBackupFile(parseBackupFileLast(await getSetting<unknown>(AUTO_BACKUP_FILE_LAST_KEY, null))),
    enabled: on,
    staleTime: 0,
    refetchOnWindowFocus: true
  });
  // The browser checks whether a file still exists in the background and reports it as a change.
  const lastId = location && 'id' in location ? location.id : null;
  useEffect(() => {
    if (lastId === null || typeof chrome === 'undefined' || !chrome.downloads?.onChanged) return;
    const onChanged = (delta: { id?: unknown }) => {
      if (delta?.id === lastId) void recheckLocation();
    };
    chrome.downloads.onChanged.addListener(onChanged);
    return () => chrome.downloads.onChanged.removeListener(onChanged);
  }, [lastId, recheckLocation]);

  const canShow = canShowBackupFolder();
  const handleShow = async () => {
    if (!canShow) return;
    // Ask again first: a file deleted a moment ago must open the Downloads folder, not nothing.
    const current = (await recheckLocation()).data;
    const result = await showBackupFile(current?.kind === 'found' ? current.id : null);
    if (result === 'unavailable') toast.error(t('backups.file.showUnavailable'));
    else if (result === 'failed') toast.error(t('backups.file.showFailed'));
  };
  const folderCheck = validateBackupFolder(folder);
  const patternCheck = validateBackupFilePattern(pattern);
  const fieldsDisabled = disabled || !on;

  // Turning it ON asks the browser for the permission FIRST, as the very first call in the click
  // (no await before it): browsers only show the prompt from a user action. Off needs nothing.
  const handleToggle = (checked: boolean) => {
    if (!checked) {
      void onSave({ autoBackupFileEnabled: false });
      return;
    }
    chrome.permissions
      .request({ permissions: [BACKUP_FILE_PERMISSION] })
      .then(async (granted) => {
        await recheckPermission();
        if (!granted) {
          toast.error(t('backups.file.permissionDenied'));
          return;
        }
        await onSave({ autoBackupFileEnabled: true });
      })
      .catch(() => toast.error(t('backups.file.permissionDenied')));
  };

  const commitFolder = () => {
    if (folderCheck.ok && folderCheck.value !== file.folder) void onSave({ autoBackupFileFolder: folderCheck.value });
  };
  const commitPattern = () => {
    if (patternCheck.ok && patternCheck.value !== file.pattern) void onSave({ autoBackupFilePattern: patternCheck.value });
  };
  const handleReset = () => {
    setFolder(DEFAULT_BACKUP_FILE_FOLDER);
    setPattern(DEFAULT_BACKUP_FILE_PATTERN);
    void onSave({ autoBackupFileFolder: DEFAULT_BACKUP_FILE_FOLDER, autoBackupFilePattern: DEFAULT_BACKUP_FILE_PATTERN });
  };

  const isDefault = file.folder === DEFAULT_BACKUP_FILE_FOLDER && file.pattern === DEFAULT_BACKUP_FILE_PATTERN && folder === file.folder && pattern === file.pattern;
  const preview =
    folderCheck.ok && patternCheck.ok
      ? t('backups.file.downloadsPath', { path: buildBackupFilePath(folderCheck.value, patternCheck.value, { createdAt: previewAt, ...PREVIEW }) })
      : null;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Label className="text-sm">{t('backups.file.toggle')}</Label>
          <p className="text-xs text-muted-foreground">{t('backups.file.description')}</p>
          {revoked && <p className="text-xs text-amber-500 mt-0.5">{t('backups.file.permissionRevoked')}</p>}
        </div>
        <Switch className="shrink-0" aria-label={t('backups.file.toggle')} checked={on} disabled={disabled} onCheckedChange={handleToggle} />
      </div>

      {on && (
        <div className="min-w-0 space-y-2 border border-border p-2">
          <p className="text-xs text-muted-foreground">{t('backups.file.location')}</p>

          <div className="min-w-0 space-y-1">
            <Label htmlFor={folderId} className="text-xs">
              {t('backups.file.folderLabel')}
            </Label>
            <Input
              id={folderId}
              className="h-7 w-full min-w-0 text-xs rounded-none"
              value={folder}
              disabled={fieldsDisabled}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!folderCheck.ok}
              aria-describedby={!folderCheck.ok ? `${folderId}-error` : undefined}
              onChange={(e) => setFolder(e.target.value)}
              onBlur={commitFolder}
            />
            {!folderCheck.ok && (
              <p id={`${folderId}-error`} className="text-xs text-destructive">
                {folderCheck.error}
              </p>
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor={patternId} className="text-xs">
              {t('backups.file.patternLabel')}
            </Label>
            <Input
              id={patternId}
              className="h-7 w-full min-w-0 text-xs rounded-none"
              value={pattern}
              disabled={fieldsDisabled}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!patternCheck.ok}
              aria-describedby={`${patternId}-help${!patternCheck.ok ? ` ${patternId}-error` : ''}`}
              onChange={(e) => setPattern(e.target.value)}
              onBlur={commitPattern}
            />
            {!patternCheck.ok && (
              <p id={`${patternId}-error`} className="text-xs text-destructive">
                {patternCheck.error}
              </p>
            )}
            <p id={`${patternId}-help`} className="text-[11px] text-muted-foreground break-words">
              {t('backups.file.tokenHelp', {
                tokens: formatList(BACKUP_FILE_TOKENS.map((tk) => t('backups.file.token', { token: tk.token, meaning: tk.meaning }))),
                extension: BACKUP_FILE_EXTENSION
              })}
            </p>
          </div>

          <div className="flex items-start justify-between gap-2 min-w-0">
            <p className="min-w-0 flex-1 text-[11px] text-muted-foreground break-all" aria-live="polite">
              {preview ? t('backups.file.example', { path: preview }) : t('backups.file.fixField')}
            </p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0 rounded-none" disabled={fieldsDisabled || isDefault} onClick={handleReset}>
              {t('backups.file.reset')}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">{t('backups.file.whereToFind')}</p>
          <p className="text-[11px] text-muted-foreground">{t('backups.file.retention')}</p>

          {/* Where the last file really is. The path comes from the browser, so it is shown as
              text only (never a link, never markup) and wraps inside the popup's width. */}
          <div className="min-w-0 space-y-1 border-t border-border pt-2" role="group" aria-labelledby={lastFileId}>
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p id={lastFileId} className="text-xs font-medium">
                  {t('backups.file.lastFileLabel')}
                </p>
                {location?.kind === 'found' && (
                  <>
                    <p className="text-[11px] break-all select-text" data-testid="backup-file-path">
                      {location.path}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {t('backups.file.savedAgo', { ago: relativeTimeStr(location.at), when: formatFileTime(location.at) })}
                    </p>
                  </>
                )}
                {location?.kind === 'pending' && <p className="text-[11px] text-muted-foreground">{t('backups.file.lastFilePending')}</p>}
                {location?.kind === 'gone' && (
                  <p className="text-[11px] text-muted-foreground">
                    {t('backups.file.goneSavedAgo', { gone: t('backups.file.lastFileGone'), ago: relativeTimeStr(location.at), when: formatFileTime(location.at) })}
                  </p>
                )}
                {/* The browser was not asked, or has nothing recorded: say what the last write did
                    (its path is the one inside Downloads that TabMerger asked for). */}
                {(location?.kind === 'none' || location?.kind === 'unavailable') &&
                  (status ? (
                    <p className="text-[11px] text-muted-foreground break-all">
                      {t('backups.file.lastFileAgo', { ago: relativeTimeStr(status.at), result: describeBackupFile(status.result, status.path) })}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{t('backups.file.noneYet')}</p>
                  ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                // `aria-disabled`, not `disabled`: the reason below stays reachable from the button
                className="h-7 px-2 text-xs shrink-0 rounded-none aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                aria-disabled={!canShow}
                aria-describedby={!canShow ? `${lastFileId}-unavailable` : undefined}
                onClick={() => void handleShow()}
              >
                <FolderOpen className="h-3 w-3" />
                {location?.kind === 'found' ? t('backups.file.showInFolder') : t('backups.file.showDownloadsFolder')}
              </Button>
            </div>
            {!canShow && (
              <p id={`${lastFileId}-unavailable`} className="text-[11px] text-muted-foreground">
                {t('backups.file.showUnavailable')}
              </p>
            )}
            {/* A newer write that did not produce a file: the last file above is the one before it. */}
            {status && status.result !== 'saved' && location && location.kind !== 'none' && location.kind !== 'unavailable' && (
              <p className="text-[11px] text-amber-500">
                {t('backups.file.lastAttemptAgo', { ago: relativeTimeStr(status.at), result: describeBackupFile(status.result, status.path) })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
