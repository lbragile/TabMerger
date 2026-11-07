/**
 * Auto-save open tabs: the extension's background worker saves the open tabs into a new
 * "Auto-saved" group on a schedule and/or when the number of open tabs passes a threshold.
 * Everything both packages need to agree on lives here: the option allow-lists, defaults, the
 * Free rolling cap, the alarm name, the runtime message types and the pricing copy.
 *
 * Free: off by default, the newest {@link AUTO_SAVE_FREE_KEEP_COUNT} auto-saves made on Free are
 * kept (the oldest is replaced), and auto-saves count toward the Free group and tab limits.
 * Pro / Pro AI: on by default, every auto-save is kept.
 */

/** Auto-saves made on Free that are kept; the next one replaces the oldest. */
export const AUTO_SAVE_FREE_KEEP_COUNT = 2;

/** Schedule options in minutes. `0` = no schedule. Anything else read from storage becomes the default. */
export const AUTO_SAVE_INTERVAL_OPTIONS = [0, 15, 30, 60, 120, 240, 1440] as const;
export type AutoSaveIntervalMinutes = (typeof AUTO_SAVE_INTERVAL_OPTIONS)[number];
export const DEFAULT_AUTO_SAVE_INTERVAL_MINUTES: AutoSaveIntervalMinutes = 60;

/** Open-tab thresholds. `0` = no threshold. */
export const AUTO_SAVE_THRESHOLD_OPTIONS = [0, 20, 30, 50, 75, 100] as const;
export type AutoSaveTabThreshold = (typeof AUTO_SAVE_THRESHOLD_OPTIONS)[number];
export const DEFAULT_AUTO_SAVE_TAB_THRESHOLD: AutoSaveTabThreshold = 0;

/** A browser notification after each auto-save: off unless the user turns it on. */
export const DEFAULT_AUTO_SAVE_NOTIFY = false;

/**
 * The on/off default when the user never chose: on for a paid plan, off for Free. Once the user
 * toggles it, the stored value wins whatever the plan.
 */
export function defaultAutoSaveEnabled(paid: boolean): boolean {
  return paid;
}

/** `chrome.alarms` name. Must not start with the reminder prefix (`reminder-`). */
export const AUTO_SAVE_ALARM_NAME = 'tm-auto-save';

/** Minimum time between two threshold-triggered runs, so a burst of new tabs saves once. */
export const AUTO_SAVE_THRESHOLD_MIN_GAP_MS = 10 * 60 * 1000;

/**
 * How long a remembered "Free" answer lets a background run for a switch the user never touched
 * stop without asking the server again (Free's default is off). Bounds how long someone who just
 * upgraded waits for the Pro default; any settings change asks again at once.
 */
export const AUTO_SAVE_FREE_RECHECK_MS = 3 * 60 * 60 * 1000;

/** Slack for the periodic alarm, which fires a few seconds short of one interval since the last run's stamp. */
export const AUTO_SAVE_DUE_TOLERANCE_MS = 2 * 60 * 1000;

/** Runtime messages between the popup and the background worker. */
export const AUTO_SAVE_MESSAGE = {
  /** Popup → worker: the auto-save settings were saved, re-arm the alarm. */
  SETTINGS_CHANGED: 'TM_AUTO_SAVE_SETTINGS_CHANGED',
  /** Popup → worker: run now ("Auto-save now"). The reply is the run's outcome. */
  RUN_NOW: 'TM_AUTO_SAVE_RUN_NOW',
  /** Worker → open extension pages: a run ended (saved or skipped), refresh the status line. */
  STATUS_CHANGED: 'TM_AUTO_SAVE_STATUS_CHANGED',
} as const;

export const AUTO_SAVE_COPY = {
  /** Line in the Free plan's feature list. */
  pricingFeatureFree: `Auto-save open tabs (newest ${AUTO_SAVE_FREE_KEEP_COUNT} kept)`,
  /** Line in the Pro plan's feature list. */
  pricingFeaturePro: 'Auto-save open tabs, all kept',
} as const;

export function isAutoSaveInterval(value: unknown): value is AutoSaveIntervalMinutes {
  return typeof value === 'number' && (AUTO_SAVE_INTERVAL_OPTIONS as readonly number[]).includes(value);
}

export function isAutoSaveThreshold(value: unknown): value is AutoSaveTabThreshold {
  return typeof value === 'number' && (AUTO_SAVE_THRESHOLD_OPTIONS as readonly number[]).includes(value);
}

/**
 * Whether a scheduled run is due. `lastRunAt` not a positive finite number = never; a stamp in
 * the future (clock moved back) counts as due.
 */
export function isAutoSaveDue(lastRunAt: unknown, intervalMinutes: number, now: number): boolean {
  if (intervalMinutes <= 0) return false;
  if (typeof lastRunAt !== 'number' || !Number.isFinite(lastRunAt) || lastRunAt <= 0) return true;
  if (lastRunAt > now) return true;
  return now - lastRunAt >= intervalMinutes * 60 * 1000 - AUTO_SAVE_DUE_TOLERANCE_MS;
}
