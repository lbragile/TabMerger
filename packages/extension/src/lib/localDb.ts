import { openDB, type IDBPDatabase } from 'idb';
import type { Group, GroupsState, Session } from './types';
import { createNowOpenGroup } from './utils';

const DB_NAME = 'tabmerger';
const DB_VERSION = 1;

export interface TabMergerDB {
  groups: {
    key: string;
    value: Group;
    indexes: { 'by-updatedAt': number };
  };
  groupsState: {
    key: string;
    value: { id: 'state'; active: GroupsState['active']; order?: string[] };
  };
  sessions: {
    key: string;
    value: Session;
    indexes: { 'by-createdAt': number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

let dbInstance: IDBPDatabase<TabMergerDB> | null = null;

/**
 * Notifies the background entrypoint that a group-changing write committed, so it can
 * rebuild the "Save to TabMerger" context menu. Writers run in BOTH the popup/extension
 * pages AND the background service worker itself (syncEngine, urlRuleEngine, background.ts
 * command handlers) — `chrome.runtime.sendMessage` never delivers to the SENDER's own
 * `onMessage` listeners, so a write issued from inside the SW would otherwise be silently
 * dropped. The background entrypoint registers a direct callback via
 * {@link registerGroupsChangeListener} for that in-SW case; everywhere else (the popup) we
 * fall through to `sendMessage`, which also wakes a sleeping service worker as a side effect
 * of delivery — that's what lets a popup-issued write rebuild the menu even after the SW
 * was evicted for inactivity.
 *
 * Deliberately NOT called by `markGroupSynced`/`markAllGroupsPendingSync` — those only flip
 * the `pendingSync` flag and never change anything the menu displays.
 */
type GroupsChangeListener = () => void;
let backgroundGroupsChangeListener: GroupsChangeListener | null = null;

export function registerGroupsChangeListener(listener: GroupsChangeListener): void {
  backgroundGroupsChangeListener = listener;
}

function notifyGroupsChanged(): void {
  if (backgroundGroupsChangeListener) {
    backgroundGroupsChangeListener();
    return;
  }
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage({ type: 'TM_GROUPS_CHANGED' }, () => {
      // Swallow "Receiving end does not exist" — e.g. no background listener registered
      // yet, or the extension context is mid-reload. Reading lastError marks it "handled"
      // so it doesn't surface as an unhandled error.
      void chrome.runtime.lastError;
    });
  } catch {
    // Extension context invalidated (page navigating away, extension reloading) — nothing to do.
  }
}

export async function getDb(): Promise<IDBPDatabase<TabMergerDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<TabMergerDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('groups')) {
        const groupsStore = db.createObjectStore('groups', { keyPath: 'id' });
        groupsStore.createIndex('by-updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('groupsState')) {
        db.createObjectStore('groupsState', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessionsStore = db.createObjectStore('sessions', { keyPath: 'id' });
        sessionsStore.createIndex('by-createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }
    }
  });

  return dbInstance;
}

/**
 * Tail of the serialized `saveGroupsState` chain. Reads wait for it (read-your-writes).
 *
 * Why: callers write the query cache optimistically and THEN `await saveGroupsState`
 * (the DnD drop commits the cache synchronously for a single-paint drop). The write's
 * readwrite transaction is only created after internal awaits, so a `getGroupsState`
 * started in that gap — e.g. `useGroups` (staleTime 0) refetching because the drop just
 * mounted a component — read the PRE-write state and overwrote the fresh cache with it.
 * Measured in the real popup: a tab dropped on a sprung-open group painted correctly for
 * 3 frames, then reverted when that refetch resolved ~150ms later, while IDB was correct.
 */
let groupsWriteTail: Promise<void> = Promise.resolve();

/**
 * Incremented SYNCHRONOUSLY each time a groups write is issued. A read captures it at
 * start; if a write was issued while that read was in flight (after it already waited
 * for the tail), the read may have opened its transaction before the write and must
 * re-read. This is what lets a refetch that started BEFORE a DnD drop self-correct to
 * the post-drop state — instead of the drop cancelling in-flight queries, which rejected
 * any mutation that had joined that fetch (TanStack hands joiners the raw fetch promise).
 */
let groupsWriteGen = 0;

/** A read never loops forever under a continuous write stream (e.g. Now Open churn). */
const MAX_READ_ATTEMPTS = 5;

/**
 * The in-flight "empty DB → create Now Open" initialization. Two first-run readers that
 * both observe an empty DB (e.g. `useGroups` + `useCurrentTabs`) must share ONE created
 * group: with serialized writes, a second creation would delete the first one's group
 * (orphan prune) and leave that caller's cache pointing at a missing id.
 * `issuedGen` = the write generation after its write was issued. A reader whose read
 * started at or after that generation read AFTER the write, so an empty DB there means
 * the store was wiped since — it creates a fresh group instead of reusing a stale one.
 */
let emptyInit: { promise: Promise<GroupsState>; issuedGen: number } | null = null;

export async function getGroupsState(): Promise<GroupsState> {
  for (let attempt = 1; ; attempt++) {
    const startGen = groupsWriteGen;
    // Never observe a state older than a write that has already been issued.
    await groupsWriteTail;
    const result = await readGroupsStateOnce(startGen);
    if (groupsWriteGen === startGen || attempt >= MAX_READ_ATTEMPTS) return result;
  }
}

async function readGroupsStateOnce(startGen: number): Promise<GroupsState> {
  const db = await getDb();
  const tx = db.transaction(['groups', 'groupsState'], 'readonly');

  const [stateRecord, allGroups] = await Promise.all([
    tx.objectStore('groupsState').get('state'),
    tx.objectStore('groups').getAll()
  ]);

  await tx.done;

  // Deduplicate permanent groups: keep oldest (lowest updatedAt), delete the rest
  let groups = allGroups;
  const permanents = groups.filter((g) => g.permanent).sort((a, b) => a.updatedAt - b.updatedAt);
  if (permanents.length > 1) {
    const extraIds = new Set(permanents.slice(1).map((g) => g.id));
    await Promise.all([...extraIds].map((id) => db.delete('groups', id)));
    groups = groups.filter((g) => !extraIds.has(g.id));
  }

  // Sort groups: use explicit saved order when available (preserves drag order across reloads).
  // Fall back to updatedAt desc for legacy data that pre-dates the order field.
  let sorted: Group[];
  if (stateRecord?.order?.length) {
    const posMap = new Map<string, number>(stateRecord.order.map((id: string, i: number): [string, number] => [id, i]));
    sorted = [...groups].sort((a, b) => {
      if (a.permanent && !b.permanent) return -1;
      if (!a.permanent && b.permanent) return 1;
      // Groups not in the saved order (e.g. newly added) go to the end
      return (posMap.get(a.id) ?? Infinity) - (posMap.get(b.id) ?? Infinity);
    });
  } else {
    sorted = [...groups].sort((a, b) => {
      if (a.permanent && !b.permanent) return -1;
      if (!a.permanent && b.permanent) return 1;
      return b.updatedAt - a.updatedAt;
    });
  }

  if (sorted.length === 0) {
    if (!emptyInit || startGen >= emptyInit.issuedGen) {
      const nowOpen = createNowOpenGroup();
      const initial: GroupsState = { active: { id: nowOpen.id, index: 0 }, available: [nowOpen] };
      const write = saveGroupsState(initial);
      const entry = {
        issuedGen: groupsWriteGen,
        promise: write.then(
          () => initial,
          (err: unknown) => {
            if (emptyInit === entry) emptyInit = null; // let the next read retry
            throw err;
          }
        )
      };
      emptyInit = entry;
    }
    const shared = await emptyInit.promise;
    // Fresh objects per caller — callers (e.g. the savedAt migration) mutate what they get.
    return { active: { ...shared.active }, available: shared.available.map((g) => ({ ...g, windows: [...g.windows] })) };
  }

  const active = stateRecord?.active ?? { id: sorted[0].id, index: 0 };
  return { active, available: sorted };
}

/**
 * Persist the full groups state. Writes are SERIALIZED (issued order = applied order)
 * and `getGroupsState` waits for the tail — see {@link groupsWriteTail}.
 */
export function saveGroupsState(state: GroupsState): Promise<void> {
  groupsWriteGen++;
  const prev = groupsWriteTail;
  let release!: () => void;
  // The queue tail is a SEPARATE promise that only ever resolves, so a failed write can't
  // wedge later reads/writes — and the promise returned below has NO handler attached, so
  // an unawaited caller's failure (quota, abort) still raises `unhandledrejection` (Sentry).
  groupsWriteTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return (async () => {
    await prev;
    try {
      await writeGroupsState(state);
    } finally {
      release();
    }
  })();
}

async function writeGroupsState(state: GroupsState): Promise<void> {
  const db = await getDb();

  const keepIds = new Set(state.available.map((g) => g.id));

  // Read existing keys outside the write transaction — avoids auto-commit between awaits
  const allKeys = await db.getAllKeys('groups');
  const orphanIds = (allKeys as string[]).filter((k) => !keepIds.has(k));

  // Fire all writes in a single transaction with no internal awaits
  const tx = db.transaction(['groups', 'groupsState'], 'readwrite');
  await Promise.all([
    ...orphanIds.map((id) => tx.objectStore('groups').delete(id)),
    ...state.available.map((g) => tx.objectStore('groups').put(g)),
    tx.objectStore('groupsState').put({ id: 'state', active: state.active, order: state.available.map((g) => g.id) }),
  ]);
  await tx.done;
  notifyGroupsChanged();
}

export async function saveGroup(group: Group): Promise<void> {
  const db = await getDb();
  await db.put('groups', group);
  notifyGroupsChanged();
}

export async function deleteGroup(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('groups', id);
  notifyGroupsChanged();
}

export async function getSessions(): Promise<Session[]> {
  const db = await getDb();
  const sessions = await db.getAll('sessions');
  return sessions.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSession(session: Session): Promise<void> {
  const db = await getDb();
  await db.put('sessions', session);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('sessions', id);
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const db = await getDb();
  const record = await db.get('settings', key);
  if (record === undefined) return defaultValue;
  const stored = (record as { id: string; value: T }).value;
  // Merge over defaultValue so fields added after a user's settings object was last
  // saved (e.g. aiDailyThrottle) fall back to their default instead of being undefined —
  // without this, new settings silently render "off" for any existing install.
  // Arrays are excluded from the merge: `{ ...[], ...storedArray }` produces a plain
  // object (spreading into `{}` always drops array-ness), which broke iteration for
  // any array-defaulted setting (e.g. urlRules) the moment a value had been saved.
  if (Array.isArray(defaultValue)) return stored;
  return typeof defaultValue === 'object' && defaultValue !== null && typeof stored === 'object' && stored !== null
    ? { ...defaultValue, ...stored }
    : stored;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('settings', { id: key, value });
}

export async function getPendingSyncGroups(): Promise<Group[]> {
  const db = await getDb();
  const all = await db.getAll('groups');
  return all.filter((g) => g.pendingSync);
}

export async function markGroupSynced(id: string): Promise<void> {
  const db = await getDb();
  const group = await db.get('groups', id);
  if (group) {
    await db.put('groups', { ...group, pendingSync: false });
  }
}

/** Marks every local group dirty so the next push re-sends all of them — used right after
 * encryption setup so existing Supabase rows (still plaintext) get overwritten with ciphertext. */
/** Wipes local groups/sessions state — used when the signed-in Supabase account changes
 * (see useSync's last-signed-in-user check) so a different account never inherits the
 * previous account's locally-cached data (which would get pushed as "mine" and collide
 * with that account's own rows under RLS). Settings are intentionally left alone — they're
 * device-level prefs, not per-account data. */
export async function clearLocalAccountData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['groups', 'groupsState', 'sessions'], 'readwrite');
  await Promise.all([
    tx.objectStore('groups').clear(),
    tx.objectStore('groupsState').clear(),
    tx.objectStore('sessions').clear(),
    tx.done
  ]);
  notifyGroupsChanged();
}

export async function markAllGroupsPendingSync(): Promise<void> {
  const db = await getDb();
  const all = await db.getAll('groups');
  const tx = db.transaction('groups', 'readwrite');
  await Promise.all([
    ...all.map((g) => tx.store.put({ ...g, pendingSync: true })),
    tx.done
  ]);
}
