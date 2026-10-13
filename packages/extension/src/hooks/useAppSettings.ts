import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AUTO_BACKUP_MESSAGE,
  DEFAULT_AUTO_BACKUP_ENABLED,
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  DEFAULT_BACKUP_FILE_ENABLED,
  DEFAULT_BACKUP_FILE_FOLDER,
  DEFAULT_BACKUP_FILE_PATTERN,
  type AutoBackupIntervalMinutes
} from '@tabmerger/shared';
import { getSetting, setSetting } from '@/lib/localDb';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  confirmOnDelete: boolean;
  syncEnabled: boolean;
  openTabOnClick: boolean;
  autoDedupOnMerge: boolean;
  staleThresholdDays: 7 | 14 | 30 | 60;
  showPreviewImages: boolean;
  aiDailyThrottle: boolean;
  aiAutoGroupEnabled: boolean;
  aiNameGroupEnabled: boolean;
  aiSuggestSessionsEnabled: boolean;
  aiOrganizeEnabled: boolean;
  aiTabSummaryEnabled: boolean;
  /** Automatic backups (Pro). Stored objects saved before these existed lack them, and stored values are validated: read through `readAutoBackupSettings`. */
  autoBackupEnabled: boolean;
  autoBackupIntervalMinutes: AutoBackupIntervalMinutes;
  /** "Also save a file to this computer". The folder and pattern become a path on disk: always read through `readAutoBackupSettings`. */
  autoBackupFileEnabled: boolean;
  autoBackupFileFolder: string;
  autoBackupFilePattern: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'system',
  confirmOnDelete: false,
  syncEnabled: true,
  openTabOnClick: true,
  autoDedupOnMerge: false,
  staleThresholdDays: 30,
  showPreviewImages: false,
  aiDailyThrottle: true,
  aiAutoGroupEnabled: true,
  aiNameGroupEnabled: true,
  aiSuggestSessionsEnabled: true,
  aiOrganizeEnabled: true,
  aiTabSummaryEnabled: true,
  autoBackupEnabled: DEFAULT_AUTO_BACKUP_ENABLED,
  autoBackupIntervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  autoBackupFileEnabled: DEFAULT_BACKUP_FILE_ENABLED,
  autoBackupFileFolder: DEFAULT_BACKUP_FILE_FOLDER,
  autoBackupFilePattern: DEFAULT_BACKUP_FILE_PATTERN
};

/**
 * Tells the background worker the settings were saved, so it re-arms the backup alarm with the
 * current on/off state and interval (alarms can only be managed there). Best effort: the worker
 * also re-arms itself every time it starts.
 */
function notifyBackupSettingsChanged(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage({ type: AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED }, () => void chrome.runtime.lastError);
  } catch {
    // extension context invalidated (reloading): nothing to do
  }
}

export const APP_SETTINGS_QUERY_KEY = ['appSettings'] as const;

/**
 * Reads the single 'appSettings' record from IndexedDB via TanStack Query.
 * staleTime:0 (like useGroups) so every subscriber always reflects the latest
 * saved value once the query is invalidated — this is what makes a Settings
 * save show up immediately in every other part of the popup without a reopen,
 * and what makes a post-login invalidation (see useSync) show correct values.
 */
export function useAppSettings() {
  return useQuery({
    queryKey: APP_SETTINGS_QUERY_KEY,
    queryFn: () => getSetting<AppSettings>('appSettings', DEFAULT_APP_SETTINGS),
    staleTime: 0,
    refetchOnWindowFocus: false
  });
}

/** Persists appSettings to IndexedDB and updates the shared cache so every subscriber re-renders immediately. */
export function useSaveAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: AppSettings) => {
      await setSetting('appSettings', next);
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(APP_SETTINGS_QUERY_KEY, next);
      notifyBackupSettingsChanged();
    }
  });
}
