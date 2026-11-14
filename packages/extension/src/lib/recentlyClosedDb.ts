import { RECENTLY_CLOSED_MESSAGE } from '@tabmerger/shared';
import { getDb } from '@/lib/localDb';
import { APP_SETTINGS_KEY } from '@/lib/syncSettingKeys';
import {
  nextClearedPurgeAt,
  parseRecentlyClosedEntry,
  planPrune,
  readRememberClosedTabs,
  type RecentlyClosedEntry,
  type RecentlyClosedLimits
} from '@/lib/recentlyClosed';

/**
 * The `recentlyClosed` IndexedDB store ("Recently closed tabs"). Device-local: never synced, never
 * encrypted, not in the JSON export, automatic backups or the undo stack, and kept across sign-out
 * (like the browser's own history). "Clear all data" wipes it with everything else.
 *
 * Writers: the background worker (recording, pruning, deleting cleared entries) and the popup
 * (reopen, remove, clear, undo). Every write is ONE transaction, so a recording and a popup write
 * at the same moment can't lose each other's change; the store is separate from the groups store,
 * so it never takes the groups write lock.
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

/**
 * Records one close, in ONE transaction with the settings store: re-reads "Remember closed tabs"
 * inside it (turning it off stops recording at once, even for a close already in flight), adds the
 * entry, drops an older tab entry with the same URL, prunes by age and count for `limits` and deletes
 * cleared entries past the undo window. Resolves whether it wrote.
 */
export async function addRecentlyClosedEntry(entry: RecentlyClosedEntry, limits: RecentlyClosedLimits, now: number = Date.now()): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction([STORE, 'settings'], 'readwrite');
  const store = tx.objectStore(STORE);
  const settings = (await tx.objectStore('settings').get(APP_SETTINGS_KEY)) as { value?: unknown } | undefined;
  if (!readRememberClosedTabs(settings?.value)) {
    await tx.done;
    return false;
  }
  const existing = (await store.getAll()).map(parseRecentlyClosedEntry).filter((e): e is RecentlyClosedEntry => e !== null);
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
  // stored rows that don't parse (corrupt, or written by a newer version with another shape) are dropped
  const corrupt = all.filter((_, i) => parsed[i] === null).map((raw) => (raw as { id?: unknown }).id).filter((id): id is string => typeof id === 'string');
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
 * marks every entry not already marked. Resolves the ids it marked: hand them to
 * {@link unmarkRecentlyClosedCleared} to undo.
 */
export async function markRecentlyClosedCleared(ids: readonly string[] | 'all', now: number = Date.now()): Promise<string[]> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const wanted = ids === 'all' ? null : new Set(ids);
  const all = (await tx.store.getAll()).map(parseRecentlyClosedEntry).filter((e): e is RecentlyClosedEntry => e !== null);
  const marking = all.filter((e) => e.clearedAt === undefined && (wanted === null || wanted.has(e.id)));
  await Promise.all([...marking.map((e) => tx.store.put({ ...e, clearedAt: now })), tx.done]);
  return marking.map((e) => e.id);
}

/** Undo of a clear: takes the mark off the entries that still exist. Resolves how many came back. */
export async function unmarkRecentlyClosedCleared(ids: readonly string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const found = await Promise.all(ids.map((id) => tx.store.get(id)));
  const back = found.filter((e): e is RecentlyClosedEntry => e !== undefined && e.clearedAt !== undefined);
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
