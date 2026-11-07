import { nanoid } from 'nanoid';
import {
  AUTO_SAVE_FREE_KEEP_COUNT,
  AUTO_SAVE_THRESHOLD_MIN_GAP_MS,
  DEFAULT_AUTO_SAVE_INTERVAL_MINUTES,
  DEFAULT_AUTO_SAVE_NOTIFY,
  DEFAULT_AUTO_SAVE_TAB_THRESHOLD,
  FREE_TIER_LIMITS,
  defaultAutoSaveEnabled,
  isAutoSaveDue,
  isAutoSaveInterval,
  isAutoSaveThreshold,
  isTourDemoGroup,
  type AutoSaveIntervalMinutes,
  type AutoSaveTabThreshold
} from '@tabmerger/shared';
import { formatDateTime, lazyMessages, t } from '@/lib/i18n';
import type { Group, GroupsState, Tab, Tier, Window } from '@/lib/types';
import { createGroup, formatGroupCounts, getFaviconUrl } from '@/lib/utils';
import { normalizeUrl } from '@/lib/deduplication';
import { countSavedGroupsAndTabs } from '@/lib/groupCounts';
import { rollingToReplace } from '@/lib/autoSaveGroups';
import { isTourPracticeUrl } from '@/lib/tourPracticeTab';

/**
 * Auto-save open tabs: the decisions, as pure functions, plus the settings reader. The background
 * worker's side (alarm, threshold listener, the run with its IndexedDB write) is in
 * `lib/autoSaveRun.ts`; this module has no `chrome.*`, no IndexedDB and no network, so the popup
 * can import it too.
 */

/** The auto-save settings, validated. */
export interface AutoSaveSettings {
  enabled: boolean;
  /** The user chose on/off themselves (the stored value wins over the plan's default). */
  explicit: boolean;
  intervalMinutes: AutoSaveIntervalMinutes;
  threshold: AutoSaveTabThreshold;
  notify: boolean;
}

/**
 * Reads the auto-save settings out of a stored `appSettings` value. A stored value is never
 * trusted: anything that is not a boolean / an allow-listed option becomes the default. A missing
 * on/off value (settings saved before this feature, or never toggled) is the plan's default:
 * `paid` on, Free off.
 */
export function readAutoSaveSettings(appSettings: unknown, paid: boolean): AutoSaveSettings {
  const raw = typeof appSettings === 'object' && appSettings !== null ? (appSettings as Record<string, unknown>) : {};
  const explicit = typeof raw.autoSaveTabsEnabled === 'boolean';
  return {
    enabled: explicit ? (raw.autoSaveTabsEnabled as boolean) : defaultAutoSaveEnabled(paid),
    explicit,
    intervalMinutes: isAutoSaveInterval(raw.autoSaveIntervalMinutes) ? raw.autoSaveIntervalMinutes : DEFAULT_AUTO_SAVE_INTERVAL_MINUTES,
    threshold: isAutoSaveThreshold(raw.autoSaveTabThreshold) ? raw.autoSaveTabThreshold : DEFAULT_AUTO_SAVE_TAB_THRESHOLD,
    notify: typeof raw.autoSaveNotify === 'boolean' ? raw.autoSaveNotify : DEFAULT_AUTO_SAVE_NOTIFY
  };
}

/** The plan remembered from the last server answer (`AUTO_SAVE_TIER_SEEN_KEY`), or `null`. */
export function parseTierSeen(raw: unknown): Tier | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const tier = (raw as Record<string, unknown>).tier;
  return tier === 'free' || tier === 'pro' || tier === 'pro_ai' ? tier : null;
}

/**
 * The plan a run acts on:
 *  - `confirmed`: the server answered now (or nobody is signed in: that is Free);
 *  - `unknown`: the check failed. `remembered` is the last answer, if any.
 */
export type RunTier = { kind: 'confirmed'; tier: Tier } | { kind: 'unknown'; remembered: Tier | null };

/** Whether the plan counts as paid for the on/off default and the limits (unknown: the remembered answer, none = Free). */
export function treatAsPaid(tier: RunTier): boolean {
  const t0 = tier.kind === 'confirmed' ? tier.tier : tier.remembered;
  return t0 === 'pro' || t0 === 'pro_ai';
}

/**
 * Every reason a run can end without a new group:
 *  - `disabled`: auto-save is off (a manual "Auto-save now" ignores this);
 *  - `not-due`: the schedule's interval has not passed (scheduled runs only);
 *  - `no-tabs`: no open tab in a normal window could be saved;
 *  - `nothing-new`: every open tab is already saved somewhere;
 *  - `no-group-slot`: Free, at the group limit with no auto-save to replace;
 *  - `no-tab-room`: Free, at the tab limit;
 *  - `account-mismatch`: the local store still holds another account's data;
 *  - `busy`: another run is in progress.
 */
export const AUTO_SAVE_SKIP_REASONS = ['disabled', 'not-due', 'no-tabs', 'nothing-new', 'no-group-slot', 'no-tab-room', 'account-mismatch', 'busy'] as const;
export type AutoSaveSkipReason = (typeof AUTO_SAVE_SKIP_REASONS)[number];

export type AutoSaveOutcome =
  /** `saved` of `total` new tabs went in (fewer only at the Free tab limit); `replaced` auto-saves were removed. */
  | { status: 'saved'; at: number; groupId: string; groupName: string; saved: number; total: number; replaced: number }
  | { status: 'skipped'; at: number; reason: AutoSaveSkipReason }
  | { status: 'error'; at: number };

/** What is remembered between runs (`AUTO_SAVE_STATE_KEY`). */
export interface AutoSaveState {
  /** last scheduled run (alarm / worker start / settings change) that passed the due check */
  lastScheduledAt?: number;
  /** how the last run that did something ended: the Settings status line */
  last?: AutoSaveOutcome;
}

/** The outcome when it has a shape this module produces; `null` for anything else (a stored value or a reply is never trusted blindly). */
export function parseAutoSaveOutcome(raw: unknown): AutoSaveOutcome | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : null;
  if (at === null) return null;
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
  if (r.status === 'saved' && typeof r.groupId === 'string' && typeof r.groupName === 'string') {
    return { status: 'saved', at, groupId: r.groupId.slice(0, 64), groupName: r.groupName.slice(0, 200), saved: count(r.saved), total: count(r.total), replaced: count(r.replaced) };
  }
  // an explicit list, not `in` on an object: 'toString' or 'constructor' must not pass
  if (r.status === 'skipped' && (AUTO_SAVE_SKIP_REASONS as readonly unknown[]).includes(r.reason)) {
    return { status: 'skipped', at, reason: r.reason as AutoSaveSkipReason };
  }
  if (r.status === 'error') return { status: 'error', at };
  return null;
}

export function parseAutoSaveState(raw: unknown): AutoSaveState {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const state: AutoSaveState = {};
  if (typeof r.lastScheduledAt === 'number' && Number.isFinite(r.lastScheduledAt) && r.lastScheduledAt > 0) state.lastScheduledAt = r.lastScheduledAt;
  const last = parseAutoSaveOutcome(r.last);
  if (last) state.last = last;
  return state;
}

/** Whether a scheduled run is due now (an interval of 0 = no schedule = never). */
export function scheduledRunDue(state: AutoSaveState, intervalMinutes: number, now: number): boolean {
  return isAutoSaveDue(state.lastScheduledAt, intervalMinutes, now);
}

/** "Auto-saved Nov 5, 14:30", in the language chosen in Settings. */
export function autoSaveGroupName(at: number): string {
  return t('autoSave.groupName', { when: formatDateTime(at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
}

/** A browser tab as `chrome.tabs.query` returns it: the fields auto-save reads. */
export interface LiveTab {
  windowId?: number;
  index?: number;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  incognito?: boolean;
  groupId?: number;
}

export interface LiveWindow {
  id?: number;
  type?: string;
  incognito?: boolean;
}

export interface LiveTabGroup {
  id: number;
  title?: string;
  color: string;
}

/**
 * The open tabs as saved windows, the same selection "Now Open" shows: normal windows only (never
 * private / incognito ones, never popups or app windows), in the browser's window order, tabs in
 * tab-strip order, this extension's own pages left out. Each tab is a detached saved copy (`id: 0`,
 * `savedAt`), keeping its Chrome tab group's name and colour. Pinned tabs and browser pages stay in.
 */
export function openWindowsToSave(tabs: LiveTab[], windows: LiveWindow[], tabGroups: LiveTabGroup[], ownPagePrefix: string, now: number): Window[] {
  const groupMap = new Map(tabGroups.map((g) => [g.id, g]));
  const byWindow = new Map<number, LiveTab[]>();
  for (const tab of tabs) {
    if (tab.windowId === undefined || tab.incognito) continue;
    const list = byWindow.get(tab.windowId) ?? [];
    list.push(tab);
    byWindow.set(tab.windowId, list);
  }
  const out: Window[] = [];
  for (const w of windows) {
    if (w.id === undefined || w.type !== 'normal' || w.incognito) continue;
    const saved: Tab[] = (byWindow.get(w.id) ?? [])
      .slice()
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((live) => ({ live, url: live.url || live.pendingUrl || '' }))
      .filter(({ url }) => url !== '' && !url.startsWith(ownPagePrefix) && !isTourPracticeUrl(url))
      .map(({ live, url }) => {
        const tab: Tab = { id: 0, title: live.title || url, url, favIconUrl: live.favIconUrl || getFaviconUrl(url), savedAt: now };
        const chromeGroup = live.groupId !== undefined && live.groupId !== -1 ? groupMap.get(live.groupId) : undefined;
        if (chromeGroup) tab.chromeGroup = { id: chromeGroup.id, name: chromeGroup.title ?? '', color: chromeGroup.color };
        return tab;
      });
    if (saved.length > 0) out.push({ id: w.id, tabs: saved, incognito: false, focused: false });
  }
  return out;
}

/** The number of open tabs the threshold compares with: tabs in normal, non-private windows. */
export function countThresholdTabs(tabs: LiveTab[], windows: LiveWindow[]): number {
  const counted = new Set(windows.filter((w) => w.id !== undefined && w.type === 'normal' && !w.incognito).map((w) => w.id));
  return tabs.filter((tab) => !tab.incognito && tab.windowId !== undefined && counted.has(tab.windowId)).length;
}

/** The threshold trigger's memory (worker session storage). */
export interface ThresholdState {
  /** a run may fire once the count goes above the threshold */
  armed: boolean;
  /** last threshold run, epoch ms (0 = none) */
  lastRunAt: number;
}

export const INITIAL_THRESHOLD_STATE: ThresholdState = { armed: true, lastRunAt: 0 };

export function parseThresholdState(raw: unknown): ThresholdState {
  if (typeof raw !== 'object' || raw === null) return INITIAL_THRESHOLD_STATE;
  const r = raw as Record<string, unknown>;
  return {
    armed: typeof r.armed === 'boolean' ? r.armed : true,
    lastRunAt: typeof r.lastRunAt === 'number' && Number.isFinite(r.lastRunAt) && r.lastRunAt >= 0 ? r.lastRunAt : 0
  };
}

/**
 * The threshold trigger with hysteresis: it fires once when the count goes ABOVE the threshold,
 * then only after the count came back down to the threshold or below (re-armed) AND at least
 * `AUTO_SAVE_THRESHOLD_MIN_GAP_MS` after the previous threshold run. A burst of new tabs saves
 * once, not once per tab. A threshold of 0 (off) never fires.
 */
export function thresholdStep(count: number, threshold: number, state: ThresholdState, now: number): { run: boolean; next: ThresholdState } {
  if (threshold <= 0 || count <= threshold) return { run: false, next: { ...state, armed: true } };
  if (!state.armed) return { run: false, next: state };
  const sinceLast = now - state.lastRunAt;
  // a stamp in the future (clock moved back) does not block the trigger
  if (state.lastRunAt > 0 && sinceLast >= 0 && sinceLast < AUTO_SAVE_THRESHOLD_MIN_GAP_MS) return { run: false, next: state };
  return { run: true, next: { armed: false, lastRunAt: now } };
}

/** What one run does to the groups. */
export interface AutoSavePlanOptions {
  tier: RunTier;
  now: number;
  /** test seam */
  id?: string;
  name: string;
}

export type AutoSavePlan =
  | { kind: 'write'; state: GroupsState; group: Group; saved: number; total: number; replaced: number }
  | { kind: 'skip'; reason: Extract<AutoSaveSkipReason, 'no-tabs' | 'nothing-new' | 'no-group-slot' | 'no-tab-room'> };

/**
 * Decides one auto-save against the groups as they are stored right now (runs inside the atomic
 * groups read-modify-write). Pure.
 *
 *  1. Replacement (Free only, plan confirmed by the server now): when the newest
 *     `AUTO_SAVE_FREE_KEEP_COUNT` rolling auto-saves already exist, the oldest goes, in the same
 *     write that adds the new one. Unknown plan or a paid plan: nothing is ever removed.
 *     Auto-saves made on a paid plan are not rolling and are never replaced.
 *  2. Duplicates: a tab whose address is already in any group (normal, archived, kept or
 *     auto-saved) is skipped, except in the group about to be replaced, whose still-open tabs carry
 *     forward into the new one. An address open in several tabs is saved once.
 *  3. Nothing new: no group, nothing removed.
 *  4. Free limits (Free, or an unknown plan without a remembered paid answer): auto-saves count
 *     toward the group and tab limits. No free group slot (normal groups are never removed): skip.
 *     Near the tab limit: the tabs that fit, in window order ("Saved X of Y").
 *  5. The new group goes last, marked `pendingSync` (so a paid account uploads it, encrypted), never
 *     at index 0. `rolling` only when made on a confirmed Free plan.
 */
export function planAutoSave(current: GroupsState, liveWindows: Window[], opts: AutoSavePlanOptions): AutoSavePlan {
  if (liveWindows.every((w) => w.tabs.length === 0)) return { kind: 'skip', reason: 'no-tabs' };
  const confirmedFree = opts.tier.kind === 'confirmed' && opts.tier.tier === 'free';
  const limited = !treatAsPaid(opts.tier);

  const replace = confirmedFree ? rollingToReplace(current.available, AUTO_SAVE_FREE_KEEP_COUNT) : [];
  const replaceIds = new Set(replace.map((g) => g.id));
  const kept = current.available.filter((g) => !replaceIds.has(g.id));

  const seen = new Set<string>();
  for (const g of kept) {
    if (g.permanent || isTourDemoGroup(g)) continue;
    for (const w of g.windows ?? []) for (const tab of w.tabs ?? []) seen.add(normalizeUrl(tab.url));
  }
  let windows: Window[] = [];
  for (const w of liveWindows) {
    const tabs = w.tabs.filter((tab) => {
      const key = normalizeUrl(tab.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (tabs.length > 0) windows.push({ ...w, tabs });
  }
  const total = windows.reduce((n, w) => n + w.tabs.length, 0);
  if (total === 0) return { kind: 'skip', reason: 'nothing-new' };

  let saved = total;
  if (limited) {
    const counts = countSavedGroupsAndTabs(kept);
    if (counts.groups + 1 > FREE_TIER_LIMITS.groups) return { kind: 'skip', reason: 'no-group-slot' };
    const room = FREE_TIER_LIMITS.tabs - counts.tabs;
    if (room <= 0) return { kind: 'skip', reason: 'no-tab-room' };
    if (total > room) {
      let left = room;
      windows = windows
        .map((w) => {
          const tabs = w.tabs.slice(0, Math.max(0, left));
          left -= tabs.length;
          return { ...w, tabs };
        })
        .filter((w) => w.tabs.length > 0);
      saved = room;
    }
  }

  const group: Group = {
    ...createGroup(opts.id ?? nanoid(10), opts.name),
    updatedAt: opts.now,
    windows,
    info: formatGroupCounts(windows.length, saved),
    pendingSync: true,
    autoSave: { at: opts.now, rolling: confirmedFree }
  };
  const available = [...kept, group];
  // the active group keeps meaning the same group; one that was replaced hands over to "Now Open"
  const activeIndex = available.findIndex((g) => g.id === current.active.id);
  const active = activeIndex >= 0 ? { id: current.active.id, index: activeIndex } : { id: available[0].id, index: 0 };
  return { kind: 'write', state: { ...current, active, available }, group, saved, total, replaced: replace.length };
}

const SKIP_MESSAGES: Readonly<Record<Exclude<AutoSaveSkipReason, 'no-group-slot' | 'no-tab-room'>, string>> = lazyMessages({
  disabled: 'autoSave.status.skip.disabled',
  'not-due': 'autoSave.status.skip.notDue',
  'no-tabs': 'autoSave.status.skip.noTabs',
  'nothing-new': 'autoSave.status.skip.nothingNew',
  'account-mismatch': 'autoSave.status.skip.accountMismatch',
  busy: 'autoSave.status.skip.busy'
});

/** One sentence about how a run ended (toast after "Auto-save now", notification, Settings status line). */
export function describeAutoSaveOutcome(outcome: AutoSaveOutcome | null): { ok: boolean; message: string } {
  if (!outcome || outcome.status === 'error') return { ok: false, message: t('autoSave.status.failed') };
  if (outcome.status === 'skipped') {
    if (outcome.reason === 'no-group-slot') return { ok: false, message: t('autoSave.status.skip.noGroupSlot', { max: FREE_TIER_LIMITS.groups }) };
    if (outcome.reason === 'no-tab-room') return { ok: false, message: t('autoSave.status.skip.noTabRoom', { max: FREE_TIER_LIMITS.tabs }) };
    return { ok: false, message: SKIP_MESSAGES[outcome.reason] };
  }
  if (outcome.saved < outcome.total) {
    return { ok: true, message: t('autoSave.status.savedPartial', { saved: outcome.saved, total: outcome.total, name: outcome.groupName }) };
  }
  return { ok: true, message: t('autoSave.status.saved', { count: outcome.saved, name: outcome.groupName }) };
}
