/**
 * Automatic backups (Pro): the extension periodically saves a snapshot of the saved groups as a
 * session marked `auto`. Everything both packages need to agree on lives here: the interval
 * allow-list, defaults, retention, the alarm name, the runtime message types and the copy.
 */

/** The intervals a user may pick, in minutes. Anything else read from storage or the UI is replaced by the default. */
export const AUTO_BACKUP_INTERVALS = [
  { minutes: 60, label: 'Every hour' },
  { minutes: 360, label: 'Every 6 hours' },
  { minutes: 720, label: 'Every 12 hours' },
  { minutes: 1440, label: 'Daily' },
  { minutes: 10080, label: 'Weekly' },
] as const;

export type AutoBackupIntervalMinutes = (typeof AUTO_BACKUP_INTERVALS)[number]['minutes'];

export const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES: AutoBackupIntervalMinutes = 1440;

/** On unless the user turned it off (only entitled accounts ever run one). */
export const DEFAULT_AUTO_BACKUP_ENABLED = true;

/** How many automatic backups are kept; older automatic ones are deleted. Manual sessions never count. */
export const AUTO_BACKUP_RETENTION_COUNT = 10;

/** `chrome.alarms` name. Must not start with the reminder prefix (`reminder-`). */
export const AUTO_BACKUP_ALARM_NAME = 'tm-auto-backup';

/**
 * An alarm fires a little before a full interval has passed since the last backup was stamped
 * (the stamp is taken when the run starts, the alarm is periodic). Without this slack an hourly
 * alarm would find "59 min 58 s elapsed, not due" and wait a whole extra period.
 */
export const AUTO_BACKUP_DUE_TOLERANCE_MS = 2 * 60 * 1000;

/** Runtime messages between the popup and the background worker. */
export const AUTO_BACKUP_MESSAGE = {
  /** Popup → worker: the backup settings were saved, re-arm the alarm. */
  SETTINGS_CHANGED: 'TM_AUTO_BACKUP_SETTINGS_CHANGED',
  /** Popup → worker: run a backup now ("Back up now"). The reply is the run's outcome. */
  RUN_NOW: 'TM_AUTO_BACKUP_RUN_NOW',
  /** Worker → open extension pages: a backup was written, refresh the list. */
  COMPLETED: 'TM_AUTO_BACKUP_COMPLETED',
} as const;

/**
 * How long a "this account is not paid" answer is remembered before a SCHEDULED check asks the
 * server again. It bounds how long someone who just upgraded waits for their first scheduled
 * backup; "Back up now" and saving any setting ask again at once.
 */
export const AUTO_BACKUP_FREE_RECHECK_MS = 3 * 60 * 60 * 1000;

/**
 * Bounds applied to a backup DOWNLOADED from the account before it is stored (the file import
 * has its own rules and is not affected). Rows, groups and backups beyond a count are left out;
 * text longer than its limit is cut; a tab whose address is longer than `urlLength` is left out.
 */
export const AUTO_BACKUP_DOWNLOAD_LIMITS = {
  /** newest `sessions` rows read */
  rows: 100,
  groupsPerBackup: 2000,
  windowsPerGroup: 500,
  tabsPerWindow: 5000,
  /** backup, group and window names */
  nameLength: 200,
  /** tab titles */
  titleLength: 2000,
  /** notes on tabs, windows and groups */
  noteLength: 10000,
  urlLength: 8192,
} as const;

// Copy states only what the feature does: it runs while the browser is open, keeps a fixed
// number of snapshots, and the copy in the account needs encryption unlocked. No "never lose".
export const AUTO_BACKUP_COPY = {
  title: 'Automatic backups',
  description: `Saves an encrypted snapshot of your groups on the schedule below while your browser is open. The newest ${AUTO_BACKUP_RETENTION_COUNT} are kept.`,
  /** Line shown in the Pro plan's feature list. */
  pricingFeature: 'Automatic encrypted backups of your groups, with an optional file copy on your computer',
  upgradeDescription: `Automatic backups are part of Pro: an encrypted snapshot of your groups, saved on a schedule, with the newest ${AUTO_BACKUP_RETENTION_COUNT} kept.`,
  /** Shown next to backups kept in the account of a plan without cloud sync (free, or a paid plan that is not active). */
  readOnlyNote: 'New backups need Pro. Your existing backups can still be downloaded or deleted.',
  /** Start of every automatic backup's name ("Automatic backup · Oct 11, 2:00 PM"), and the label on the web dashboard. */
  namePrefix: 'Automatic backup',
  /**
   * What deleting a backup IN THE EXTENSION removes. A backup that is missing from the account
   * is never deleted from a browser because of that, so a copy another browser already holds
   * stays there. (Deleting in the web dashboard removes the cloud copy only.)
   */
  deleteScope: 'It is removed from this browser and from your account. Another browser that already has it keeps its own copy.',
} as const;

export function isAutoBackupInterval(value: unknown): value is AutoBackupIntervalMinutes {
  return typeof value === 'number' && AUTO_BACKUP_INTERVALS.some((o) => o.minutes === value);
}

/** The interval to use for a value from storage or the UI: itself when allow-listed, otherwise the default. */
export function normalizeAutoBackupInterval(value: unknown): AutoBackupIntervalMinutes {
  return isAutoBackupInterval(value) ? value : DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES;
}

/** The enabled flag to use for a value from storage: only a real boolean is taken, anything else is the default. */
export function normalizeAutoBackupEnabled(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_AUTO_BACKUP_ENABLED;
}

/**
 * Whether a backup is due. `lastBackupAt` is the stored time of the last automatic backup
 * (anything that is not a positive finite number means "never"). A stamp in the future (the
 * clock was moved back) counts as due, so a wrong clock cannot switch backups off.
 */
export function isAutoBackupDue(lastBackupAt: unknown, intervalMinutes: AutoBackupIntervalMinutes, now: number): boolean {
  if (typeof lastBackupAt !== 'number' || !Number.isFinite(lastBackupAt) || lastBackupAt <= 0) return true;
  if (lastBackupAt > now) return true;
  return now - lastBackupAt >= intervalMinutes * 60 * 1000 - AUTO_BACKUP_DUE_TOLERANCE_MS;
}

/** "Automatic backup · Oct 11, 2:00 PM" */
export function autoBackupName(createdAt: number, locale?: string): string {
  const when = new Date(createdAt).toLocaleString(locale ?? 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${AUTO_BACKUP_COPY.namePrefix} · ${when}`;
}
