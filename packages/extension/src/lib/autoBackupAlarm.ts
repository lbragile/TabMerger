import { AUTO_BACKUP_ALARM_NAME, AUTO_BACKUP_MESSAGE } from '@tabmerger/shared';
import { getSetting, setSetting } from '@/lib/localDb';
import { readAutoBackupSettings, runAutoBackup, type AutoBackupOutcome } from '@/lib/autoBackup';
import { isOwnExtensionPage } from '@/lib/messageSender';
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys';

/**
 * The background worker's side of automatic backups: the `chrome.alarms` schedule and the popup's
 * messages. Kept out of `background.ts` so that file only needs one call
 * ({@link registerAutoBackup}). Nothing here runs a groups sync: a run only creates a backup.
 */

/** Setting: when a scheduled (non-manual) run was last attempted, whatever its outcome. Device-level. */
export const AUTO_BACKUP_LAST_ATTEMPT_KEY = 'autoBackupLastAttemptAt';

/**
 * A worker start only re-checks "is a backup due" this long after the previous attempt. An MV3
 * worker restarts many times an hour, and an attempt can end in a network request (the
 * subscription check), so without this a signed-in free account would make one on every start.
 */
export const STARTUP_CHECK_MIN_GAP_MS = 15 * 60 * 1000;

/** Whether a worker-start check may run, given the stored last attempt (not a number = never attempted). */
export function startupCheckAllowed(lastAttemptAt: unknown, now: number): boolean {
  if (typeof lastAttemptAt !== 'number' || !Number.isFinite(lastAttemptAt)) return true;
  if (lastAttemptAt > now) return true; // clock moved back
  return now - lastAttemptAt >= STARTUP_CHECK_MIN_GAP_MS;
}

/**
 * Makes the alarm match the saved settings: cleared when backups are off, otherwise one periodic
 * alarm whose period is the chosen interval. An alarm that already has the right period is LEFT
 * ALONE: creating it again restarts its countdown, and since this runs on every worker start a
 * long interval would never elapse.
 */
export async function armAutoBackupAlarm(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  const { enabled, intervalMinutes } = readAutoBackupSettings(await getSetting<unknown>(APP_SETTINGS_KEY, null));
  if (!enabled) {
    await chrome.alarms.clear(AUTO_BACKUP_ALARM_NAME);
    return;
  }
  const existing = await chrome.alarms.get(AUTO_BACKUP_ALARM_NAME);
  if (existing?.periodInMinutes === intervalMinutes) return;
  await chrome.alarms.create(AUTO_BACKUP_ALARM_NAME, { delayInMinutes: intervalMinutes, periodInMinutes: intervalMinutes });
}

/** Tells open extension pages a backup was written, so a visible list refreshes. */
function announceCompleted(): void {
  try {
    chrome.runtime.sendMessage({ type: AUTO_BACKUP_MESSAGE.COMPLETED }, () => void chrome.runtime.lastError);
  } catch {
    // no receiver / context invalidated: nothing to refresh
  }
}

/**
 * A scheduled run. The alarm (or the worker starting, or a settings change) is only a trigger:
 * `runAutoBackup` decides from the stored last-backup time whether one is due, so a late or lost
 * alarm costs nothing and an early one does nothing.
 */
export async function runScheduledBackup(trigger: 'alarm' | 'startup' | 'settings', now: number = Date.now()): Promise<AutoBackupOutcome> {
  if (trigger === 'startup' && !startupCheckAllowed(await getSetting<unknown>(AUTO_BACKUP_LAST_ATTEMPT_KEY, null), now)) {
    return { status: 'skipped', reason: 'not-due' };
  }
  await setSetting(AUTO_BACKUP_LAST_ATTEMPT_KEY, now);
  // a settings change asks the server for the plan again (someone who just upgraded and toggles a
  // setting must not wait out a remembered "not paid" answer)
  const outcome = await runAutoBackup({ now, recheckTier: trigger === 'settings' });
  if (outcome.status === 'created') announceCompleted();
  return outcome;
}

const logFailure = (what: string) => (e: unknown) => console.warn(`[TabMerger] Automatic backup: ${what} failed`, e);

/**
 * Wires automatic backups into the background worker. Call once from `defineBackground`.
 *  - arms the alarm on worker start and on browser start, and checks whether a backup is due
 *    (covers an alarm lost while the browser was closed);
 *  - on the alarm: a scheduled run;
 *  - `SETTINGS_CHANGED` from the popup: re-arm, then a scheduled run (a shorter interval, or
 *    turning backups on, can make one due right away);
 *  - `RUN_NOW` from the popup: a manual run, answered with its outcome.
 */
export function registerAutoBackup(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return; // alarms permission not active yet (pre-reload)

  const armAndCheck = (trigger: 'startup' | 'settings') => {
    void armAutoBackupAlarm()
      .catch(logFailure('arming the alarm'))
      .then(() => runScheduledBackup(trigger))
      .catch(logFailure('the scheduled check'));
  };

  chrome.runtime.onStartup.addListener(() => armAndCheck('startup'));
  armAndCheck('startup');

  // A separate listener from the reminders one, filtered on its own exact name.
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_BACKUP_ALARM_NAME) return;
    void runScheduledBackup('alarm').catch(logFailure('the scheduled run'));
  });

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const type = (msg as { type?: unknown } | null | undefined)?.type;
    if (type !== AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED && type !== AUTO_BACKUP_MESSAGE.RUN_NOW) return;
    // This extension's id is not enough: a content script (the Firefox web bridge, which relays
    // what the web app's page posts) carries it too. Only the extension's own pages may ask.
    if (!isOwnExtensionPage(sender)) return;
    if (type === AUTO_BACKUP_MESSAGE.SETTINGS_CHANGED) {
      armAndCheck('settings');
      return;
    }
    void runAutoBackup({ manual: true }).then((outcome) => {
      if (outcome.status === 'created') announceCompleted();
      sendResponse(outcome);
    });
    return true; // keep the message channel open for the async sendResponse above
  });
}
