import {
  DEFAULT_REMEMBER_CLOSED_TABS,
  RECENTLY_CLOSED_CLEAR_DELAY_MS,
  RECENTLY_CLOSED_LIMITS,
  RECENTLY_CLOSED_MAX_FAVICON_LENGTH,
  RECENTLY_CLOSED_MAX_TITLE_LENGTH,
  RECENTLY_CLOSED_MAX_URL_LENGTH,
  RECENTLY_CLOSED_MAX_WINDOW_TABS,
  RECENTLY_CLOSED_META_ID,
  RECENTLY_CLOSED_QUIET_CLOSE_TTL_MS,
  RECENTLY_CLOSED_UNPIN_GRACE_MS,
  RECENTLY_CLOSED_STORAGE_KEYS,
  isScriptUrl
} from '@tabmerger/shared';
import { normalizeUrl } from '@/lib/deduplication';
import { RESTRICTED_URL_RE } from '@/lib/safeOpen';

/**
 * "Recently closed tabs": the pure part, shared by the background recorder
 * (lib/recentlyClosedRecorder.ts), the IndexedDB layer (lib/recentlyClosedDb.ts) and the popup's
 * hook (hooks/useRecentlyClosed.ts). No `chrome.*`, no IndexedDB, no catalog reads (the worker
 * imports it, see locales/worker.ts).
 */

/** The colours `chrome.tabGroups` accepts (Chrome, Edge and Firefox share them). */
export const TAB_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];

/** The browser tab group a tab was in when it closed. */
export interface ClosedTabGroup {
  title: string;
  color: TabGroupColor;
}

/** What the worker knows about each open tab (`tabs.onRemoved` only gives the id). */
export interface TabSnapshot {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  windowId: number;
  incognito: boolean;
  /** Position in its window when last seen: orders the tabs of a closed window. */
  index: number;
  /** Browser tab group id (`-1`/absent = none), kept so `tabGroups.onUpdated` can find its tabs. */
  groupId?: number;
  tabGroup?: ClosedTabGroup;
  /** When the tab last went from pinned to unpinned (see {@link pinnedAtClose}). */
  unpinnedAt?: number;
}

/**
 * Whether the tab counts as pinned when it closed at `closedAt`. Chrome un-pins a window's pinned
 * tabs (`onUpdated { pinned: false }`) just before closing the window, so a tab un-pinned within
 * `RECENTLY_CLOSED_UNPIN_GRACE_MS` before its close was pinned as far as the user is concerned.
 */
export function pinnedAtClose(snap: TabSnapshot, closedAt: number): boolean {
  if (snap.pinned) return true;
  return typeof snap.unpinnedAt === 'number' && closedAt >= snap.unpinnedAt && closedAt - snap.unpinnedAt <= RECENTLY_CLOSED_UNPIN_GRACE_MS;
}

/** One tab as stored in the list. */
export interface ClosedTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned?: boolean;
  tabGroup?: ClosedTabGroup;
}

/** One row of the recently-closed list: a closed tab, or a closed window with its tabs in order. */
export interface RecentlyClosedEntry {
  /** nanoid */
  id: string;
  /** epoch ms */
  closedAt: number;
  kind: 'tab' | 'window';
  /** exactly one for `tab` */
  tabs: ClosedTab[];
  /** Set by Clear list / remove a day / remove an entry / turning it off: hidden, deleted ~10 s later unless undone. */
  clearedAt?: number;
}

/**
 * The plan the list is pruned for. `unknown` (offline, the check failed, an account mismatch) keeps
 * the Pro limits: a Pro user who is briefly offline must never lose entries.
 */
export type RecentlyClosedPlan = 'free' | 'pro' | 'unknown';

/**
 * What a plan keeps (see `RECENTLY_CLOSED_LIMITS`): at most `entries`, and either the last `days`
 * calendar days (Pro) or the newest `recentDays` local days that have closes, rolling (Free).
 */
export interface RecentlyClosedLimits {
  entries: number;
  days?: number;
  recentDays?: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The local calendar day of `ms` as `YYYY-MM-DD`: the day rows' key (lib/recentlyClosedDays.ts) and
 * the unit Free's rolling window counts in. Built from the local date, so DST never moves a close
 * to another day.
 */
export function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The limits a plan keeps. Only a plan KNOWN to be Free gets the Free limits. */
export function limitsForPlan(plan: RecentlyClosedPlan): RecentlyClosedLimits {
  return plan === 'free' ? RECENTLY_CLOSED_LIMITS.free : RECENTLY_CLOSED_LIMITS.pro;
}

/**
 * The newest `count` local days (`localDayKey`) that have an entry not marked cleared: Free's
 * rolling window. At least one day. Shared by pruning ({@link planPrune}) and what the popup shows
 * ({@link entriesShownForPlan}), so the list never shows a day the next prune would delete.
 */
export function newestDayKeys(entries: readonly Pick<RecentlyClosedEntry, 'closedAt' | 'clearedAt'>[], count: number): Set<string> {
  const days = [...new Set(entries.filter((e) => e.clearedAt === undefined).map((e) => localDayKey(e.closedAt)))].sort().reverse();
  return new Set(days.slice(0, Math.max(1, count)));
}

/**
 * The entries the popup lists for `plan` (the sidebar day rows and their count, the day view,
 * Ctrl+K's closed results, the Settings count): on a plan KNOWN to be Free only the newest
 * `recentDays` local days that have entries, the same days the Free prune keeps, so the list
 * matches "Free keeps your last 2 days" even before storage was pruned. Any other plan (`pro`, or
 * `unknown` while it is loading) lists everything. Cleared entries are never listed.
 */
export function entriesShownForPlan<T extends Pick<RecentlyClosedEntry, 'closedAt' | 'clearedAt'>>(entries: readonly T[], plan: RecentlyClosedPlan): T[] {
  const live = entries.filter((e) => e.clearedAt === undefined);
  const { recentDays } = limitsForPlan(plan);
  if (recentDays === undefined) return live;
  const keep = newestDayKeys(live, recentDays);
  return live.filter((e) => keep.has(localDayKey(e.closedAt)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Browser pages "Save all tabs" leaves out, beyond `RESTRICTED_URL_RE` (`chrome:`, `about:`,
 * extension pages): the other Chromium browsers' own pages, `view-source:` and DevTools.
 */
const OTHER_BROWSER_PAGE_RE = /^(edge|brave|opera|vivaldi|view-source|devtools|chrome-search|chrome-untrusted|moz-extension|resource):/i;

/**
 * Whether a closed tab at this address is worth remembering: a page the user can reopen. The same
 * rule as saving open tabs (`RESTRICTED_URL_RE` in hooks/useGroups.ts, now in lib/safeOpen.ts):
 * browser pages, the new-tab page, extension pages and `about:` are left out, and so is any
 * script-running URL and anything longer than the stored-URL cap (a cut URL would be broken).
 */
export function isRecordableUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed === '' || trimmed.length > RECENTLY_CLOSED_MAX_URL_LENGTH) return false;
  if (isScriptUrl(trimmed) || RESTRICTED_URL_RE.test(trimmed) || OTHER_BROWSER_PAGE_RE.test(trimmed)) return false;
  return true;
}

// C0/C1 control characters and the bidi overrides/isolates a page title could use to disguise itself
const UNSAFE_TEXT_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A page title made safe to store and show: a string, no control or bidi-override characters, whitespace collapsed, capped. */
export function cleanClosedTitle(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(UNSAFE_TEXT_RE, '').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return fallback;
  if (cleaned.length <= RECENTLY_CLOSED_MAX_TITLE_LENGTH) return cleaned;
  const cut = cleaned.slice(0, RECENTLY_CLOSED_MAX_TITLE_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  // never end on half a surrogate pair
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A favicon address worth keeping: a non-script URL or an inline `data:image/...`, within the cap. */
export function cleanFavIconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '' || value.length > RECENTLY_CLOSED_MAX_FAVICON_LENGTH) return undefined;
  if (isScriptUrl(value) && !/^data:image\//i.test(value)) return undefined;
  return value;
}

function cleanTabGroup(value: unknown): ClosedTabGroup | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const g = value as { title?: unknown; color?: unknown };
  if (!(TAB_GROUP_COLORS as readonly unknown[]).includes(g.color)) return undefined;
  return { title: cleanClosedTitle(g.title), color: g.color as TabGroupColor };
}

/** The tab group of a `chrome.tabGroups.TabGroup` (or Firefox's), cleaned. */
export function tabGroupOf(group: { title?: string; color?: string } | null | undefined): ClosedTabGroup | undefined {
  return cleanTabGroup(group);
}

/**
 * A snapshot of an open tab, or `null` when it can't be one (no id or window). The url falls back to
 * `pendingUrl` (a tab still loading its first page).
 */
export function snapshotFromTab(tab: chrome.tabs.Tab, tabGroup?: ClosedTabGroup): TabSnapshot | null {
  if (typeof tab.id !== 'number' || tab.id < 0 || typeof tab.windowId !== 'number') return null;
  // private tabs are never recorded, so nothing about them is kept (not even in session storage)
  if (tab.incognito === true) return null;
  const url = tab.url || tab.pendingUrl || '';
  const snap: TabSnapshot = {
    url,
    title: typeof tab.title === 'string' ? tab.title : '',
    pinned: tab.pinned === true,
    windowId: tab.windowId,
    incognito: false,
    index: typeof tab.index === 'number' ? tab.index : 0
  };
  // capped like stored entries: a huge inline icon must not fill session storage (10 MB)
  const favIconUrl = cleanFavIconUrl(tab.favIconUrl);
  if (favIconUrl) snap.favIconUrl = favIconUrl;
  if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
    snap.groupId = tab.groupId;
    if (tabGroup) snap.tabGroup = tabGroup;
  }
  return snap;
}

/** The `tabs.onUpdated` changes the snapshot cares about (never `status`, which fires all the time). */
const SNAPSHOT_FIELDS = ['url', 'title', 'favIconUrl', 'pinned', 'groupId'] as const;

/** Whether a `tabs.onUpdated` change touches the snapshot. */
export function isSnapshotChange(changeInfo: chrome.tabs.OnUpdatedInfo | Record<string, unknown>): boolean {
  return SNAPSHOT_FIELDS.some((field) => field in changeInfo);
}

/** A snapshot turned into what is stored, cleaned, or `null` when the page is not one to remember. */
export function closedTabFromSnapshot(snap: TabSnapshot): ClosedTab | null {
  if (!isRecordableUrl(snap.url)) return null;
  const url = snap.url.trim();
  const tab: ClosedTab = { url, title: cleanClosedTitle(snap.title, url) };
  const favIconUrl = cleanFavIconUrl(snap.favIconUrl);
  if (favIconUrl) tab.favIconUrl = favIconUrl;
  if (snap.pinned) tab.pinned = true;
  const group = cleanTabGroup(snap.tabGroup);
  if (group) tab.tabGroup = group;
  return tab;
}

/**
 * Why a close is not recorded, or `null` when it is. The order matters only for tests: every reason
 * drops the snapshot the same way.
 */
export type SkipReason = 'off' | 'unknown-tab' | 'incognito' | 'not-recordable' | 'quiet';

export function skipReason(opts: { enabled: boolean; snapshot: TabSnapshot | undefined; quiet: boolean }): SkipReason | null {
  if (!opts.enabled) return 'off';
  if (!opts.snapshot) return 'unknown-tab';
  if (opts.snapshot.incognito) return 'incognito';
  if (!isRecordableUrl(opts.snapshot.url)) return 'not-recordable';
  if (opts.quiet) return 'quiet';
  return null;
}

/**
 * The entry for the tabs of one close: a `tab` entry for one tab, a `window` entry (tabs in their
 * window order, capped) for more. `null` when none of them is worth remembering.
 */
export function buildEntry(snapshots: TabSnapshot[], closedAt: number, id: string): RecentlyClosedEntry | null {
  const tabs = [...snapshots]
    .map((snap, order) => ({ snap, order }))
    .sort((a, b) => a.snap.index - b.snap.index || a.order - b.order)
    .map(({ snap }) => closedTabFromSnapshot(snap))
    .filter((tab): tab is ClosedTab => tab !== null)
    .slice(0, RECENTLY_CLOSED_MAX_WINDOW_TABS);
  if (tabs.length === 0) return null;
  return { id, closedAt, kind: tabs.length === 1 ? 'tab' : 'window', tabs };
}

/**
 * The ids to delete in the same transaction that adds `entry` (or, with no entry, on a sweep):
 *  1. an older `tab` entry with the same normalized URL as a new `tab` entry (the newest close wins);
 *  2. entries older than the plan's `days` (Pro), or outside the newest `recentDays` local days that
 *     have entries (Free: a rolling window of day rows, not necessarily consecutive dates);
 *  3. beyond the plan's count, the oldest ones;
 *  4. entries cleared longer than the undo window ago.
 * Entries marked cleared are not counted toward the limit and never deduped (their Undo must still
 * work); they leave by rule 4.
 */
export function planPrune(existing: RecentlyClosedEntry[], entry: RecentlyClosedEntry | null, limits: RecentlyClosedLimits, now: number): string[] {
  const drop = new Set<string>();
  const oldest = limits.days === undefined ? -Infinity : now - limits.days * DAY_MS;
  for (const e of existing) {
    if (e.clearedAt !== undefined) {
      if (now - e.clearedAt >= RECENTLY_CLOSED_CLEAR_DELAY_MS) drop.add(e.id);
      continue;
    }
    if (e.closedAt < oldest) drop.add(e.id);
  }
  if (entry?.kind === 'tab') {
    const key = normalizeUrl(entry.tabs[0].url);
    for (const e of existing) {
      if (e.id !== entry.id && e.clearedAt === undefined && e.kind === 'tab' && normalizeUrl(e.tabs[0]?.url ?? '') === key) drop.add(e.id);
    }
  }
  let kept = existing.filter((e) => e.clearedAt === undefined && !drop.has(e.id) && e.id !== entry?.id);
  if (entry) kept.push(entry);
  if (limits.recentDays !== undefined) {
    // the newest N local days that have entries; the entry being added is always among them
    const keepDays = newestDayKeys(kept, limits.recentDays);
    if (entry) keepDays.add(localDayKey(entry.closedAt));
    for (const e of kept) if (!keepDays.has(localDayKey(e.closedAt)) && e.id !== entry?.id) drop.add(e.id);
    kept = kept.filter((e) => !drop.has(e.id));
  }
  if (kept.length > limits.entries) {
    kept.sort((a, b) => b.closedAt - a.closedAt);
    // never the entry being added: it is the newest close (a wrong clock could make it look older)
    for (const e of kept.slice(limits.entries)) if (e.id !== entry?.id) drop.add(e.id);
  }
  return [...drop];
}

/** The earliest moment a cleared entry becomes deletable, or `null` when none is marked. */
export function nextClearedPurgeAt(entries: RecentlyClosedEntry[]): number | null {
  let next: number | null = null;
  for (const e of entries) {
    if (e.clearedAt === undefined) continue;
    const due = e.clearedAt + RECENTLY_CLOSED_CLEAR_DELAY_MS;
    if (next === null || due < next) next = due;
  }
  return next;
}

/** A stored value read back as an entry, or `null` (malformed data never reaches the UI). */
export function parseRecentlyClosedEntry(raw: unknown): RecentlyClosedEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.closedAt !== 'number' || !Number.isFinite(r.closedAt)) return null;
  if ((r.kind !== 'tab' && r.kind !== 'window') || !Array.isArray(r.tabs)) return null;
  const tabs: ClosedTab[] = [];
  for (const t of r.tabs) {
    if (typeof t !== 'object' || t === null) continue;
    const tab = t as Record<string, unknown>;
    if (!isRecordableUrl(tab.url)) continue;
    const clean: ClosedTab = { url: tab.url, title: cleanClosedTitle(tab.title, tab.url) };
    const favIconUrl = cleanFavIconUrl(tab.favIconUrl);
    if (favIconUrl) clean.favIconUrl = favIconUrl;
    if (tab.pinned === true) clean.pinned = true;
    const group = cleanTabGroup(tab.tabGroup);
    if (group) clean.tabGroup = group;
    tabs.push(clean);
  }
  if (tabs.length === 0) return null;
  const entry: RecentlyClosedEntry = { id: r.id, closedAt: r.closedAt, kind: r.kind === 'window' && tabs.length > 1 ? 'window' : 'tab', tabs: r.kind === 'tab' ? tabs.slice(0, 1) : tabs };
  if (typeof r.clearedAt === 'number' && Number.isFinite(r.clearedAt)) entry.clearedAt = r.clearedAt;
  return entry;
}

/**
 * The "Remember closed tabs" setting from the stored `appSettings` object. On by default, also for
 * settings saved before it existed (existing users at the update): only an explicit `false` is off.
 */
export function readRememberClosedTabs(rawSettings: unknown): boolean {
  if (typeof rawSettings !== 'object' || rawSettings === null || Array.isArray(rawSettings)) return DEFAULT_REMEMBER_CLOSED_TABS;
  return (rawSettings as Record<string, unknown>).rememberClosedTabs !== false;
}

/** `chrome.storage.session` key marking tab `tabId` as closed by TabMerger with its content safe elsewhere. */
export function quietCloseTabKey(tabId: number): string {
  return `${RECENTLY_CLOSED_STORAGE_KEYS.quietCloseIds}:tab:${tabId}`;
}

/** Same for a whole window TabMerger closes (every tab in it is quiet). */
export function quietCloseWindowKey(windowId: number): string {
  return `${RECENTLY_CLOSED_STORAGE_KEYS.quietCloseIds}:window:${windowId}`;
}

/** Whether a quiet-close mark written at `at` still applies at `now` (they expire after 30 s). */
export function isQuietMarkFresh(at: unknown, now: number): boolean {
  return typeof at === 'number' && Number.isFinite(at) && at <= now + 1000 && now - at < RECENTLY_CLOSED_QUIET_CLOSE_TTL_MS;
}

/** Whether a `chrome.storage.session` key is a quiet-close mark. */
export function isQuietCloseKey(key: string): boolean {
  return key.startsWith(`${RECENTLY_CLOSED_STORAGE_KEYS.quietCloseIds}:`);
}

/**
 * The store's bookkeeping row (id `RECENTLY_CLOSED_META_ID`), never an entry:
 *  - `remember`: the "Remember closed tabs" switch (absent until set or migrated from the old
 *    `appSettings.rememberClosedTabs`; absent reads as on);
 *  - `clearedBefore`: when the whole list was last cleared (Clear list, turning it off, "Clear all
 *    data"). A close that happened before it but was still queued (a window buffer, the write
 *    queue) is dropped instead of bringing a cleared list back.
 */
export interface RecentlyClosedMeta {
  id: typeof RECENTLY_CLOSED_META_ID;
  remember?: boolean;
  clearedBefore?: number;
}

export function isMetaRow(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { id?: unknown }).id === RECENTLY_CLOSED_META_ID;
}

/** The stored meta row read back, validated (anything malformed is left out). */
export function parseRecentlyClosedMeta(raw: unknown): RecentlyClosedMeta {
  const meta: RecentlyClosedMeta = { id: RECENTLY_CLOSED_META_ID };
  if (!isMetaRow(raw)) return meta;
  const r = raw as Record<string, unknown>;
  if (typeof r.remember === 'boolean') meta.remember = r.remember;
  if (typeof r.clearedBefore === 'number' && Number.isFinite(r.clearedBefore)) meta.clearedBefore = r.clearedBefore;
  return meta;
}

