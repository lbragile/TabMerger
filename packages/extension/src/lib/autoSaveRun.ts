import { AUTO_SAVE_ALARM_NAME, AUTO_SAVE_MESSAGE } from '@tabmerger/shared';
import { getSetting, setSetting, updateGroupsState } from '@/lib/localDb';
import { supabase } from '@/lib/supabase';
import { fetchTier } from '@/lib/entitlementTier';
import { isOwnExtensionPage } from '@/lib/messageSender';
import { t } from '@/lib/i18n';
import { APP_SETTINGS_KEY, AUTO_SAVE_STATE_KEY, AUTO_SAVE_TIER_SEEN_KEY, LAST_USER_ID_KEY } from '@/lib/syncSettingKeys';
import {
  autoSaveGroupName,
  countThresholdTabs,
  describeAutoSaveOutcome,
  openWindowsToSave,
  parseAutoSaveState,
  parseThresholdState,
  parseTierSeen,
  planAutoSave,
  readAutoSaveSettings,
  scheduledRunDue,
  thresholdStep,
  treatAsPaid,
  type AutoSaveOutcome,
  type AutoSavePlan,
  type AutoSaveSettings,
  type RunTier,
  type ThresholdState
} from '@/lib/autoSave';

/**
 * The background worker's side of "Auto-save open tabs": the run (plan check, browser query, one
 * atomic groups write), its lock, the schedule alarm, the open-tab threshold, the notification and
 * the popup's messages. Wired into `background.ts` by one call, {@link registerAutoSave}.
 */

export type AutoSaveTrigger = 'alarm' | 'startup' | 'settings' | 'threshold' | 'manual';

const LOCK_NAME = 'tabmerger-auto-save';
const RUNNING = Symbol.for('tabmerger.autoSaveRunning');

/** One run at a time across the popup and the worker (same shape as the backup lock). */
async function withAutoSaveLock<T>(task: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks?.request) {
    return locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => (lock ? { ran: true as const, value: await task() } : { ran: false as const }));
  }
  const g = globalThis as unknown as Record<symbol, boolean | undefined>;
  if (g[RUNNING]) return { ran: false };
  g[RUNNING] = true;
  try {
    return { ran: true, value: await task() };
  } finally {
    g[RUNNING] = false;
  }
}

/**
 * The plan for this run. Nobody signed in, on a store no account owns, is Free (confirmed: there is
 * no subscription to have); signed out on a store that still holds an account's groups is unknown.
 * Signed in: the server's answer now, remembered for when it cannot be asked; a failed check is
 * `unknown` (never "free", never "paid"). A local store still holding another account's data
 * blocks the run: its groups must not get this account's tabs.
 */
export async function resolveRunTier(now: number = Date.now()): Promise<RunTier | 'account-mismatch'> {
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data.session?.user.id ?? null;
  } catch {
    userId = null;
  }
  const owner = await getSetting<string | null>(LAST_USER_ID_KEY, null);
  // Signed out with an account's data still in the store (a signed-out Pro user keeps their pulled
  // groups): the plan is not known, so nothing may be removed. Only a store no account owns is Free.
  if (!userId) {
    return owner ? { kind: 'unknown', remembered: parseTierSeen(await getSetting<unknown>(AUTO_SAVE_TIER_SEEN_KEY, null)) } : { kind: 'confirmed', tier: 'free' };
  }
  if (owner && owner !== userId) return 'account-mismatch';
  const tier = await fetchTier(userId);
  if (tier === null) return { kind: 'unknown', remembered: parseTierSeen(await getSetting<unknown>(AUTO_SAVE_TIER_SEEN_KEY, null)) };
  await setSetting(AUTO_SAVE_TIER_SEEN_KEY, { tier, at: now });
  return { kind: 'confirmed', tier };
}

/** The settings as the stored value and the remembered plan give them, with no network request (alarm arming). */
export async function readStoredAutoSaveSettings(): Promise<AutoSaveSettings> {
  const [raw, seen] = await Promise.all([getSetting<unknown>(APP_SETTINGS_KEY, null), getSetting<unknown>(AUTO_SAVE_TIER_SEEN_KEY, null)]);
  const remembered = parseTierSeen(seen);
  return readAutoSaveSettings(raw, remembered === 'pro' || remembered === 'pro_ai');
}

async function readLiveWindows(now: number) {
  const tabGroupsAvailable = typeof chrome.tabGroups?.query === 'function';
  const [tabs, windows, tabGroups] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getAll(),
    tabGroupsAvailable ? chrome.tabGroups.query({}) : Promise.resolve([] as chrome.tabGroups.TabGroup[])
  ]);
  return openWindowsToSave(tabs, windows, tabGroups, `chrome-extension://${chrome.runtime.id}/`, now);
}

function showNotification(outcome: AutoSaveOutcome): void {
  if (typeof chrome === 'undefined' || !chrome.notifications?.create) return;
  try {
    chrome.notifications.create(`tm-auto-save-${outcome.at}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: t('autoSave.notification.title'),
      message: describeAutoSaveOutcome(outcome).message
    });
  } catch {
    // notifications unavailable (permission not active yet): the status line still says it
  }
}

function announceStatus(): void {
  try {
    chrome.runtime.sendMessage({ type: AUTO_SAVE_MESSAGE.STATUS_CHANGED }, () => void chrome.runtime.lastError);
  } catch {
    // no receiver: nothing to refresh
  }
}

/** Remembers how a run ended for the status line (and, for a scheduled run, when it ran). */
async function rememberOutcome(outcome: AutoSaveOutcome, scheduled: boolean): Promise<void> {
  const state = parseAutoSaveState(await getSetting<unknown>(AUTO_SAVE_STATE_KEY, null));
  await setSetting(AUTO_SAVE_STATE_KEY, { ...state, last: outcome, ...(scheduled ? { lastScheduledAt: outcome.at } : {}) });
}

export interface RunAutoSaveOptions {
  trigger: AutoSaveTrigger;
  /** test seam */
  now?: number;
}

/**
 * One auto-save, if every condition holds:
 *  1. on (a manual "Auto-save now" ignores the switch). A switch the user turned off stops
 *     everything before any request; otherwise the plan is checked first, because a missing
 *     switch means "the plan's default";
 *  2. a scheduled run (alarm, worker start, settings change) only when the interval has passed;
 *     a threshold run only when a threshold is set;
 *  3. the open tabs, then ONE atomic `updateGroupsState` with {@link planAutoSave}: a popup
 *     writing at the same moment is never lost, and the replacement of the oldest Free auto-save
 *     happens in the same write as the new group.
 * The new group is not an undo step (written outside the popup's history; its broadcast makes an
 * open popup refetch). The outcome is remembered for the Settings status line; a notification is
 * shown when the user asked for them (also for a Free limit skip).
 */
export async function runAutoSave({ trigger, now = Date.now() }: RunAutoSaveOptions): Promise<AutoSaveOutcome> {
  try {
    const result = await withAutoSaveLock(() => runLocked(trigger, now));
    return result.ran ? result.value : { status: 'skipped', at: now, reason: 'busy' };
  } catch (e) {
    console.warn('[TabMerger] Auto-save failed', e);
    return { status: 'error', at: now };
  }
}

async function runLocked(trigger: AutoSaveTrigger, now: number): Promise<AutoSaveOutcome> {
  const manual = trigger === 'manual';
  const scheduled = trigger === 'alarm' || trigger === 'startup' || trigger === 'settings';
  const skip = (reason: Extract<AutoSaveOutcome, { status: 'skipped' }>['reason']): AutoSaveOutcome => ({ status: 'skipped', at: now, reason });

  const rawSettings = await getSetting<unknown>(APP_SETTINGS_KEY, null);
  // Local checks first, no request: a switch the user turned off, a schedule or threshold that is
  // off, an interval not passed. (`paid: true` here only fills a missing switch; it is decided below.)
  const looseSettings = readAutoSaveSettings(rawSettings, true);
  if (!manual && looseSettings.explicit && !looseSettings.enabled) return skip('disabled');
  const state = parseAutoSaveState(await getSetting<unknown>(AUTO_SAVE_STATE_KEY, null));
  if (scheduled && !scheduledRunDue(state, looseSettings.intervalMinutes, now)) return skip('not-due');
  if (trigger === 'threshold' && looseSettings.threshold <= 0) return skip('disabled');

  const tier = await resolveRunTier(now);
  if (tier === 'account-mismatch') return finish(skip('account-mismatch'), false, null);
  const settings = readAutoSaveSettings(rawSettings, treatAsPaid(tier));
  if (!manual && !settings.enabled) return skip('disabled');

  const liveWindows = await readLiveWindows(now);
  const name = autoSaveGroupName(now);
  let plan: AutoSavePlan | null = null;
  await updateGroupsState((current) => {
    plan = planAutoSave(current, liveWindows, { tier, now, name });
    return plan.kind === 'write' ? plan.state : null;
  });
  const decided = plan as AutoSavePlan | null;
  if (!decided) return { status: 'error', at: now };
  const outcome: AutoSaveOutcome =
    decided.kind === 'write'
      ? { status: 'saved', at: now, groupId: decided.group.id, groupName: decided.group.name, saved: decided.saved, total: decided.total, replaced: decided.replaced }
      : skip(decided.reason);
  return finish(outcome, scheduled, settings);
}

async function finish(outcome: AutoSaveOutcome, scheduled: boolean, settings: AutoSaveSettings | null): Promise<AutoSaveOutcome> {
  await rememberOutcome(outcome, scheduled);
  announceStatus();
  const limitSkip = outcome.status === 'skipped' && (outcome.reason === 'no-group-slot' || outcome.reason === 'no-tab-room');
  if (settings?.notify && (outcome.status === 'saved' || limitSkip)) showNotification(outcome);
  return outcome;
}

/**
 * Makes the alarm match the saved settings (read with the remembered plan, no request): cleared
 * when auto-save is off or has no schedule, otherwise one periodic alarm. An alarm that already has
 * the right period is LEFT ALONE: creating it again restarts its countdown, and this runs on every
 * worker start.
 */
export async function armAutoSaveAlarm(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  const { enabled, intervalMinutes } = await readStoredAutoSaveSettings();
  if (!enabled || intervalMinutes <= 0) {
    await chrome.alarms.clear(AUTO_SAVE_ALARM_NAME);
    return;
  }
  const existing = await chrome.alarms.get(AUTO_SAVE_ALARM_NAME);
  if (existing?.periodInMinutes === intervalMinutes) return;
  await chrome.alarms.create(AUTO_SAVE_ALARM_NAME, { delayInMinutes: intervalMinutes, periodInMinutes: intervalMinutes });
}

const THRESHOLD_STATE_KEY = 'tmAutoSaveThreshold';
let memoryThresholdState: ThresholdState | null = null;

/** The threshold's memory lives in `chrome.storage.session` so a worker restart does not fire it again (memory as a fallback). */
async function readThresholdState(): Promise<ThresholdState> {
  try {
    if (chrome.storage?.session) return parseThresholdState((await chrome.storage.session.get(THRESHOLD_STATE_KEY))[THRESHOLD_STATE_KEY]);
  } catch {
    // fall through
  }
  return memoryThresholdState ?? parseThresholdState(null);
}

async function writeThresholdState(state: ThresholdState): Promise<void> {
  memoryThresholdState = state;
  try {
    if (chrome.storage?.session) await chrome.storage.session.set({ [THRESHOLD_STATE_KEY]: state });
  } catch {
    // memory copy kept
  }
}

/** Called on every tab opened or closed: re-arms below the threshold, runs once above it. */
export async function checkTabThreshold(now: number = Date.now()): Promise<AutoSaveOutcome | null> {
  const settings = await readStoredAutoSaveSettings();
  if (settings.threshold <= 0) return null;
  const [tabs, windows] = await Promise.all([chrome.tabs.query({}), chrome.windows.getAll()]);
  const count = countThresholdTabs(tabs, windows);
  const before = await readThresholdState();
  const { run, next } = thresholdStep(count, settings.threshold, before, now);
  if (next.armed !== before.armed || next.lastRunAt !== before.lastRunAt) await writeThresholdState(next);
  if (!run) return null;
  return runAutoSave({ trigger: 'threshold', now });
}

const logFailure = (what: string) => (e: unknown) => console.warn(`[TabMerger] Auto-save: ${what} failed`, e);

/**
 * Wires auto-save into the background worker. Call once from `defineBackground`, AFTER the
 * existing listeners (tests address listeners by index).
 *  - worker / browser start: arm the alarm, then a scheduled check (covers an alarm lost while the
 *    browser was closed; the stored last-run time decides);
 *  - the alarm: a scheduled run;
 *  - a tab opened or closed: the threshold check;
 *  - `SETTINGS_CHANGED` from an extension page: refresh the remembered plan, re-arm, check;
 *  - `RUN_NOW` from an extension page: a manual run, answered with its outcome.
 */
export function registerAutoSave(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;

  const armAndCheck = (trigger: 'startup' | 'settings') => {
    // a settings change (or the first start after an update) asks the server for the plan, so a
    // Pro account whose switch was never touched gets its default schedule armed
    const refresh = trigger === 'settings' ? resolveRunTier().then(() => undefined) : Promise.resolve();
    void refresh
      .catch(logFailure('the plan check'))
      .then(() => armAutoSaveAlarm())
      .catch(logFailure('arming the alarm'))
      .then(() => runAutoSave({ trigger }))
      .catch(logFailure('the scheduled check'));
  };

  chrome.runtime.onStartup.addListener(() => armAndCheck('startup'));
  armAndCheck('startup');

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTO_SAVE_ALARM_NAME) return;
    void runAutoSave({ trigger: 'alarm' })
      .then(() => armAutoSaveAlarm())
      .catch(logFailure('the scheduled run'));
  });

  const onTabsChanged = () => void checkTabThreshold().catch(logFailure('the open-tab check'));
  chrome.tabs.onCreated.addListener(onTabsChanged);
  chrome.tabs.onRemoved.addListener(onTabsChanged);

  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    const type = (msg as { type?: unknown } | null | undefined)?.type;
    if (type !== AUTO_SAVE_MESSAGE.SETTINGS_CHANGED && type !== AUTO_SAVE_MESSAGE.RUN_NOW) return;
    // only the extension's own pages (never a content script, see isOwnExtensionPage)
    if (!isOwnExtensionPage(sender)) return;
    if (type === AUTO_SAVE_MESSAGE.SETTINGS_CHANGED) {
      armAndCheck('settings');
      return;
    }
    void runAutoSave({ trigger: 'manual' }).then(sendResponse);
    return true; // keep the channel open for the async sendResponse
  });
}
