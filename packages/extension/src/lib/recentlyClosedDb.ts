import { DEFAULT_REMEMBER_CLOSED_TABS, RECENTLY_CLOSED_MESSAGE, RECENTLY_CLOSED_META_ID } from '@tabmerger/shared';
import { getDb } from '@/lib/localDb';
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys';
import {
  isMetaRow,
  nextClearedPurgeAt,
  parseRecentlyClosedEntry,
  parseRecentlyClosedMeta,
  planPrune,
  readRememberClosedTabs,
  type RecentlyClosedEntry,
  type RecentlyClosedLimits,
  type RecentlyClosedMeta
} from '@/lib/recentlyClosed';

/**
 * The `recentlyClosed` IndexedDB store ("Recently closed tabs"). Device-local: never synced, never
 * encrypted, not in the JSON export, automatic backups or the undo stack, and kept across sign-out
 * (like the browser's own history). "Clear all data" wipes it with everything else.
 *
 * Writers: the background worker (recording, pruning, deleting cleared entries) and the popup
 * (reopen, remove, clear, undo, the switch). Every write is ONE transaction on THIS store only (the
 * "Remember closed tabs" switch lives in the store's own meta row, see RecentlyClosedMeta), so a
 * recording and a popup write at the same moment can't lose each other's change, and a recording
 * never waits behind a groups or settings write.
 */

const STORE = 'recentlyClosed';

/** Tells open extension pages the list changed (the worker's writes; the popup refreshes its own cache directly). */
export function notifyRecentlyClosedChanged(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage({ type: RECENTLY_CLOSED_MESSAGE.CHANGED }, () => void chrome.runtime.lastError);
  } catch {
    // extension context invalidated: nothing to tell
  }
}

/** Every stored entry, validated, newest first. Cleared (pending-delete) entries only when asked. */
export async function getRecentlyClosedEntries(opts: { includeCleared?: boolean } = {}): Promise<RecentlyClosedEntry[]> {
  const db = await getDb();
  const raw = await db.getAll(STORE);
  return raw
    .map(parseRecentlyClosedEntry)
    .filter((e): e is RecentlyClosedEntry => e !== null && (opts.includeCleared === true || e.clearedAt === undefined))
    .sort((a, b) => b.closedAt - a.closedAt);
}

const entriesOf = (rows: unknown[]): RecentlyClosedEntry[] =>
  rows.map(parseRecentlyClosedEntry).filter((e): e is RecentlyClosedEntry => e !== null);

/**
 * The "Remember closed tabs" switch (meta row). The first read after the switch moved into this
 * store copies the old `appSettings.rememberClosedTabs` value over, once (see
 * {@link migrateRememberClosedTabs}); afterwards only this store is read. On by default.
 */
export async function getRememberClosedTabs(): Promise<boolean> {
  const db = await getDb();
  const meta = parseRecentlyClosedMeta(await db.get(STORE, RECENTLY_CLOSED_META_ID));
  if (meta.remember !== undefined) return meta.remember;
  return migrateRememberClosedTabs();
}

/**
 * One-time copy of the switch from `appSettings` into the meta row, in one transaction over both
 * stores, only while the row has none. The worker runs it at start, before recording anything.
 */
export async function migrateRememberClosedTabs(): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction([STORE, 'settings'], 'readwrite');
  const meta = parseRecentlyClosedMeta(await tx.objectStore(STORE).get(RECENTLY_CLOSED_META_ID));
  if (meta.remember !== undefined) {
    await tx.done;
    return meta.remember;
  }
  const settings = (await tx.objectStore('settings').get(APP_SETTINGS_KEY)) as { value?: unknown } | undefined;
  const remember = settings === undefined ? DEFAULT_REMEMBER_CLOSED_TABS : readRememberClosedTabs(settings.value);
  await Promise.all([tx.objectStore(STORE).put({ ...meta, remember }), tx.done]);
  return remember;
}

/** Sets the switch, in one transaction on this store (the rest of the meta row is kept). */
export async function setRememberClosedTabs(on: boolean): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const meta = parseRecentlyClosedMeta(await tx.store.get(RECENTLY_CLOSED_META_ID));
  await Promise.all([tx.store.put({ ...meta, remember: on }), tx.done]);
}

/**
 * Records one close, in ONE transaction on this store: re-reads the switch inside it (turning it
 * off stops recording at once, even for a close already in flight), drops a close that happened
 * before the last full clear (it was still queued when the list was cleared), adds the entry, drops
 * an older tab entry with the same URL, prunes by age and count for `limits` and deletes cleared
 * entries past the undo window. Resolves whether it wrote.
 */
export async function addRecentlyClosedEntry(entry: RecentlyClosedEntry, limits: RecentlyClosedLimits, now: number = Date.now()): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.store;
  const meta = parseRecentlyClosedMeta(await store.get(RECENTLY_CLOSED_META_ID));
  const off = (meta.remember ?? DEFAULT_REMEMBER_CLOSED_TABS) === false;
  if (off || (meta.clearedBefore !== undefined && entry.closedAt < meta.clearedBefore)) {
    await tx.done;
    return false;
  }
  const existing = entriesOf(await store.getAll());
  const drop = planPrune(existing, entry, limits, now);
  await Promise.all([store.put(entry), ...drop.map((id) => store.delete(id)), tx.done]);
  return true;
}

/**
 * Prunes without adding (the worker's start, a plan change): by age and count, plus cleared entries
 * past the undo window. Resolves how many entries were deleted and when the next cleared entry is
 * due (`null`: none marked).
 */
export async function pruneRecentlyClosed(limits: RecentlyClosedLimits, now: number = Date.now()): Promise<{ deleted: number; nextPurgeAt: number | null }> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const all = await tx.store.getAll();
  const parsed = all.map(parseRecentlyClosedEntry);
  // stored rows that don't parse (corrupt, or written by a newer version with another shape) are
  // dropped; never the meta row
  const corrupt = all
    .filter((raw, i) => parsed[i] === null && !isMetaRow(raw))
    .map((raw) => (raw as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string');
  const entries = parsed.filter((e): e is RecentlyClosedEntry => e !== null);
  const drop = [...planPrune(entries, null, limits, now), ...corrupt];
  await Promise.all([...drop.map((id) => tx.store.delete(id)), tx.done]);
  const remaining = entries.filter((e) => !drop.includes(e.id));
  return { deleted: drop.length, nextPurgeAt: nextClearedPurgeAt(remaining) };
}

/**
 * Deletes cleared entries whose undo window has passed (and only those). Resolves how many and when
 * the next one is due.
 */
export async function purgeClearedRecentlyClosed(now: number = Date.now()): Promise<{ deleted: number; nextPurgeAt: number | null }> {
  // the widest limits: this sweep removes only what was cleared, never what has merely aged
  return pruneRecentlyClosed({ entries: Number.MAX_SAFE_INTEGER, days: Number.MAX_SAFE_INTEGER / 86_400_000 }, now);
}

/**
 * Marks entries cleared (hidden at once, deleted by the worker after the undo window). `ids: 'all'`
 * marks every entry not already marked and records `clearedBefore` (a close still queued from
 * before the clear is then dropped). With `turnOff`, the switch goes off in the same transaction.
 * Resolves the ids it marked: hand them to {@link unmarkRecentlyClosedCleared} to undo.
 */
export async function markRecentlyClosedCleared(
  ids: readonly string[] | 'all',
  now: number = Date.now(),
  opts: { turnOff?: boolean } = {}
): Promise<string[]> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const wanted = ids === 'all' ? null : new Set(ids);
  const rows = await tx.store.getAll();
  const marking = entriesOf(rows).filter((e) => e.clearedAt === undefined && (wanted === null || wanted.has(e.id)));
  const meta = parseRecentlyClosedMeta(rows.find(isMetaRow));
  const nextMeta: RecentlyClosedMeta | null =
    ids === 'all' || opts.turnOff
      ? { ...meta, ...(ids === 'all' ? { clearedBefore: now } : {}), ...(opts.turnOff ? { remember: false } : {}) }
      : null;
  await Promise.all([
    ...marking.map((e) => tx.store.put({ ...e, clearedAt: now })),
    ...(nextMeta ? [tx.store.put(nextMeta)] : []),
    tx.done
  ]);
  return marking.map((e) => e.id);
}

/** Undo of a clear: takes the mark off the entries that still exist. Resolves how many came back. */
export async function unmarkRecentlyClosedCleared(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const found = await Promise.all(ids.filter((id) => id !== RECENTLY_CLOSED_META_ID).map((id) => tx.store.get(id)));
  const back = entriesOf(found).filter((e) => e.clearedAt !== undefined);
  await Promise.all([
    ...back.map((e) => {
      const { clearedAt: _cleared, ...rest } = e;
      return tx.store.put(rest);
    }),
    tx.done
  ]);
  return back.length;
}

/** Deletes entries now (a reopened entry). */
export async function deleteRecentlyClosedEntries(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

/** Puts entries back as they were (Undo of a reopen), without any cleared mark. */
export async function putRecentlyClosedEntries(entries: readonly RecentlyClosedEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await Promise.all([
    ...entries.map((e) => {
      const { clearedAt: _cleared, ...rest } = e;
      return tx.store.put(rest);
    }),
    tx.done
  ]);
}
