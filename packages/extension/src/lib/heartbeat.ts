import {
  ANALYTICS_DATA_CONSENT_CATEGORIES,
  ANALYTICS_EVENTS,
  HEARTBEAT_ALARM_NAME,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_LAST_SENT_STORAGE_KEY,
  HEARTBEAT_TIER_STORAGE_KEY,
  HEARTBEAT_TIERS,
  INSTALLED_AT_STORAGE_KEY,
  type HeartbeatTier,
} from '@tabmerger/shared';
import { trackEvent } from '@/lib/analytics';
import { hasDataConsent } from '@/lib/dataConsent';
import { releaseChannel } from '@/lib/releaseChannel';

/**
 * Daily `extension_heartbeat`: proves the extension still runs in the wild and lets GA4 count
 * active installs (unique client ids sending it in 1/7/28 days). Sent from the background worker
 * at most once per {@link HEARTBEAT_INTERVAL_MS}, on a one-shot `chrome.alarms` alarm and on every
 * worker start (alarms can be missed while the browser is closed). The stored last-sent time is
 * the decision, the alarm only a trigger. No personal data: version, browser, release channel,
 * coarse plan and whole days since install.
 */

export type HeartbeatOutcome = 'sent' | 'not-due' | 'no-consent' | 'disabled';

/** A stored epoch-ms number, or null. */
function asTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

async function readLocal(key: string): Promise<unknown> {
  return (await chrome.storage.local.get(key))[key];
}

/** Due when nothing was sent yet, a full interval has passed, or the clock moved back. */
export function isHeartbeatDue(lastSentAt: unknown, now: number): boolean {
  const last = asTimestamp(lastSentAt);
  if (last === null || last > now) return true;
  return now - last >= HEARTBEAT_INTERVAL_MS;
}

/** The demo-video build sends nothing (same rule as the uninstall survey). */
function isHeartbeatBuild(): boolean {
  return import.meta.env.VITE_DEMO_BUILD !== 'true';
}

/** `chrome`, `firefox` or `edge` (WXT's build target), anything else `other`. */
export function heartbeatBrowser(): string {
  const target = import.meta.env.BROWSER as unknown;
  return target === 'chrome' || target === 'firefox' || target === 'edge' ? target : 'other';
}

/** The event's parameters. Only values the worker already has locally; never a network request. */
export async function buildHeartbeatParams(now: number): Promise<Record<string, string | number>> {
  const params: Record<string, string | number> = {
    // Same parameter names as the server-side `extension_uninstalled` event (and the GA4 custom
    // dimensions in docs/ANALYTICS.md), so both break down by version and channel together.
    extension_version: chrome.runtime.getManifest().version,
    browser: heartbeatBrowser(),
    channel: releaseChannel(),
  };
  const tier = await readLocal(HEARTBEAT_TIER_STORAGE_KEY);
  if ((HEARTBEAT_TIERS as readonly unknown[]).includes(tier)) params.tier = tier as HeartbeatTier;
  const installedAt = asTimestamp(await readLocal(INSTALLED_AT_STORAGE_KEY));
  if (installedAt !== null && installedAt <= now) {
    params.days_since_install = Math.floor((now - installedAt) / (24 * 60 * 60 * 1000));
  }
  return params;
}

let inFlight: Promise<HeartbeatOutcome> | null = null;

async function sendIfDue(now: number): Promise<HeartbeatOutcome> {
  if (!isHeartbeatBuild()) return 'disabled';
  if (!isHeartbeatDue(await readLocal(HEARTBEAT_LAST_SENT_STORAGE_KEY), now)) return 'not-due';
  // Not stamped without consent: the first start after a Firefox opt-in sends one.
  if (!(await hasDataConsent(ANALYTICS_DATA_CONSENT_CATEGORIES))) return 'no-consent';
  // Stamped before sending: a failed request is not retried within the day, and a second
  // trigger arriving meanwhile sees it as not due.
  await chrome.storage.local.set({ [HEARTBEAT_LAST_SENT_STORAGE_KEY]: now });
  trackEvent(ANALYTICS_EVENTS.extensionHeartbeat, await buildHeartbeatParams(now));
  return 'sent';
}

/**
 * Sends the heartbeat when one is due. Concurrent triggers (worker start and alarm together)
 * share one run, so at most one event goes out.
 */
export function maybeSendHeartbeat(now: number = Date.now()): Promise<HeartbeatOutcome> {
  if (!inFlight) {
    inFlight = sendIfDue(now).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Makes sure the alarm fires by the time the next heartbeat is due: the last send plus one
 * interval, or one interval from now when that is already past (not sent for lack of consent,
 * so the check repeats daily rather than every minute). An existing alarm that fires no later
 * than that is LEFT ALONE: this runs on every worker start, and re-creating it would restart its
 * countdown. An early firing costs nothing, the due check decides.
 */
export async function armHeartbeatAlarm(now: number = Date.now()): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  const last = asTimestamp(await readLocal(HEARTBEAT_LAST_SENT_STORAGE_KEY));
  const target = last !== null && last <= now && last + HEARTBEAT_INTERVAL_MS > now ? last + HEARTBEAT_INTERVAL_MS : now + HEARTBEAT_INTERVAL_MS;
  const existing = await chrome.alarms.get(HEARTBEAT_ALARM_NAME);
  if (existing && existing.scheduledTime > now && existing.scheduledTime <= target + 60_000) return;
  await chrome.alarms.create(HEARTBEAT_ALARM_NAME, { when: target });
}

/** onInstalled: remembers the first install time (never overwritten, never set on an update). */
export async function recordInstallDate(reason: string, now: number = Date.now()): Promise<void> {
  if (reason !== 'install') return;
  if (asTimestamp(await readLocal(INSTALLED_AT_STORAGE_KEY)) !== null) return;
  await chrome.storage.local.set({ [INSTALLED_AT_STORAGE_KEY]: now });
}

const logFailure = (e: unknown) => console.warn('[TabMerger] Heartbeat failed', e);

function checkAndArm(): void {
  void maybeSendHeartbeat()
    .catch(logFailure)
    .then(() => armHeartbeatAlarm())
    .catch(logFailure);
}

/** Wires the heartbeat into the background worker. Call once from `defineBackground`. */
export function registerHeartbeat(): void {
  if (typeof chrome === 'undefined' || !chrome.alarms) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== HEARTBEAT_ALARM_NAME) return;
    checkAndArm();
  });
  checkAndArm();
}

/** Test-only: forgets a run in progress. */
export function _resetHeartbeatForTests(): void {
  inFlight = null;
}
