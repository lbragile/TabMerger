import { openDB, type IDBPDatabase } from 'idb';
import type { Group, GroupsState, Session } from './types';
import { createNowOpenGroup } from './utils';
import { GROUPS_CHANGED_MESSAGE } from './groupsChangedMessage';
import { groupContentEqual } from './syncConflict';
import { LAST_USER_ID_KEY, CLOUD_SYNC_ACTIVE_KEY, ACCOUNT_SCOPED_SETTING_KEYS } from './syncSettingKeys';

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
    value: { id: 'state'; active: GroupsState['active']; order?: string[]; rev?: number };
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
  // In-SW half first (sendMessage never reaches the sender's own listeners), then ALWAYS
  // fall through to `sendMessage` too: it is also how the OTHER contexts learn the groups
  // changed — the popup's `useExternalGroupsChanges` refetches on it, so a write issued by
  // the service worker (context menu, URL rule, SYNC_NOW) shows up in an open popup.
  backgroundGroupsChangeListener?.();
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
  try {
    chrome.runtime.sendMessage({ type: GROUPS_CHANGED_MESSAGE }, () => {
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
    const result = await readGroupsStateOnce(startGen, attempt >= MAX_READ_ATTEMPTS);
    if (result && (groupsWriteGen === startGen || attempt >= MAX_READ_ATTEMPTS)) return result;
  }
}

/**
 * One read. Returns `null` when the DB looks empty but a write was issued since the read
 * started: creating the initial group then would queue a write AFTER that one and clobber
 * it (the empty observation is stale), so the caller re-reads instead. `allowCreate` (last
 * attempt) forces creation so a continuous write stream can't starve the first-run init.
 */
async function readGroupsStateOnce(startGen: number, allowCreate: boolean): Promise<GroupsState | null> {
  const stored = await readStoredGroupsState();
  if (stored) return stored;
  if (!allowCreate && groupsWriteGen !== startGen) return null;

  if (!emptyInit || startGen >= emptyInit.issuedGen) {
    const initial = createInitialGroupsState();
    const write = saveGroupsState(initial);
    const entry = {
      issuedGen: groupsWriteGen,
      promise: write.then(
        (rev) => ({ ...initial, rev }),
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
  return { active: { ...shared.active }, available: shared.available.map((g) => ({ ...g, windows: [...g.windows] })), rev: shared.rev };
}

function createInitialGroupsState(): GroupsState {
  const nowOpen = createNowOpenGroup();
  return { active: { id: nowOpen.id, index: 0 }, available: [nowOpen], rev: 0 };
}

/**
 * Raw read of the stored state, or `null` when the store is empty. NEVER writes the
 * initial group and never touches the write queue, so it is the one reader that is safe
 * to call from inside a queued/locked step ({@link updateGroupsState}); `getGroupsState`
 * would deadlock there (it waits for the very tail that step holds).
 */
async function readStoredGroupsState(): Promise<GroupsState | null> {
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

  if (sorted.length === 0) return null;

  const active = stateRecord?.active ?? { id: sorted[0].id, index: 0 };
  return { active, available: sorted, rev: stateRecord?.rev ?? 0 };
}

const GROUPS_LOCK_NAME = 'tabmerger-groups-write';
const FALLBACK_LOCK_TAIL = Symbol.for('tabmerger.groupsLockTail');

/**
 * Cross-context mutual exclusion for groups writes. The popup, other extension pages and the
 * MV3 service worker each load their own copy of this module (own queue + generation) on ONE
 * IndexedDB, so the in-context queue alone can't stop their read-modify-writes from
 * interleaving. The Web Locks API (same-origin extension pages and the SW) can. Without it
 * (jsdom, very old browsers) fall back to a promise chain on `globalThis`: still correct
 * across module copies in one JS context, just not across contexts. A lock is released
 * automatically if its holder dies, so a closed popup can never wedge the worker.
 * Tasks run under the lock must stay short (IDB only — never network or chrome.* calls).
 */
function withGroupsLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks?.request) return locks.request(GROUPS_LOCK_NAME, task) as Promise<T>;
  const g = globalThis as unknown as Record<symbol, Promise<unknown> | undefined>;
  const run = (g[FALLBACK_LOCK_TAIL] ?? Promise.resolve()).then(task);
  g[FALLBACK_LOCK_TAIL] = run.catch(() => undefined);
  return run;
}

/**
 * Runs `task` as the next step of the serialized groups-write chain (issued order = applied
 * order), under the cross-context lock. Every groups-store mutation goes through here so a
 * wipe, a full-state write and a read-modify-write can't reorder each other. The generation
 * is bumped SYNCHRONOUSLY at issue time (see {@link groupsWriteGen}).
 */
function enqueueGroupsWrite<T>(task: () => Promise<T>): Promise<T> {
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
      return await withGroupsLock(task);
    } finally {
      release();
    }
  })();
}

/**
 * Persist the full groups state. Writes are SERIALIZED (issued order = applied order)
 * and `getGroupsState` waits for the tail — see {@link groupsWriteTail}.
 *
 * This is a BLIND overwrite: it prunes any stored group missing from `state`. Use it only
 * when `state` is derived from the live cache in the same tick (DnD drop, undo/redo,
 * import); anything that reads, awaits something, then writes must use
 * {@link updateGroupsState} so a concurrent write is not lost.
 *
 * `expectedRev` makes it an optimistic-concurrency write: inside the lock the stored `rev`
 * must still equal it, otherwise nothing is written and the promise rejects with
 * {@link StaleGroupsError} (the base the caller derived `state` from is out of date).
 * Resolves with the new `rev`.
 */
export function saveGroupsState(state: GroupsState, opts: { expectedRev?: number } = {}): Promise<number> {
  return enqueueGroupsWrite(async () => (await writeGroupsState(state, opts.expectedRev, true)).rev ?? 0);
}

/**
 * Atomic read-modify-write of the groups state. `fn` runs on a FRESH read taken inside the
 * serialized queue AND the cross-context lock, so no other write (this context's or the
 * service worker's) can land between its read and the write of its result. `fn` must be
 * synchronous and pure apart from cheap side effects — never await, never call
 * `getGroupsState`/`saveGroupsState` from it (deadlock). Return `null` to skip the write.
 * Resolves with the state after the step (`fn`'s result, or the unchanged fresh state).
 * An empty store is presented to `fn` as the initial Now Open state (and persisted with
 * `fn`'s result) instead of triggering the read path's lazy init write.
 */
export function updateGroupsState(
  fn: (current: GroupsState, aux: UpdateAux) => GroupsState | null,
  opts: { readPendingDeletes?: boolean; readSignedInUser?: boolean } = {}
): Promise<GroupsState> {
  return enqueueGroupsWrite(async () => {
    const current = (await readStoredGroupsState()) ?? createInitialGroupsState();
    // Read INSIDE the lock so a delete committed before this step is always visible to `fn`.
    const pendingDeletes = new Set(opts.readPendingDeletes ? await getPendingGroupDeletes() : []);
    const signedInUserId = opts.readSignedInUser ? await getSetting<string | null>(LAST_USER_ID_KEY, null) : null;
    const next = fn(current, { pendingDeletes, signedInUserId });
    if (!next) return current;
    return writeGroupsState(next);
  });
}

/** Extra context handed to an {@link updateGroupsState} callback. */
export interface UpdateAux {
  /** Group ids with a remote delete not yet confirmed (only filled with `readPendingDeletes`). */
  pendingDeletes: Set<string>;
  /** Persisted id of the account whose data this store holds (only filled with `readSignedInUser`). */
  signedInUserId: string | null;
}
/** Oldest pending-delete ids are dropped past this many (a stuck backlog must not grow forever). */
const MAX_PENDING_DELETES = 500;

/** Thrown by an `expectedRev` write whose base state is out of date. */
export class StaleGroupsError extends Error {
  constructor() {
    super('groups changed since the base state was read');
    this.name = 'StaleGroupsError';
  }
}

/**
 * Persisted ids of groups deleted locally whose Supabase row is not confirmed gone yet. Lives
 * in the settings store so it survives popup close / SW eviction; `performSync` retries the
 * remote DELETE every cycle and the merge treats these ids as absent (no resurrection).
 * `writeGroupsState` maintains it in the SAME transaction as the local removal.
 */
export const PENDING_DELETE_KEY = 'pendingDeleteGroupIds';

export function getPendingGroupDeletes(): Promise<string[]> {
  return getSetting<string[]>(PENDING_DELETE_KEY, []);
}

/** Atomic (one readwrite transaction) edit of the pending-delete set. */
async function editPendingGroupDeletes(edit: (ids: Set<string>) => void): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('settings', 'readwrite');
  const record = (await tx.store.get(PENDING_DELETE_KEY)) as { id: string; value: string[] } | undefined;
  const ids = new Set(record?.value ?? []);
  edit(ids);
  capPendingDeletes(ids);
  await Promise.all([tx.store.put({ id: PENDING_DELETE_KEY, value: [...ids] }), tx.done]);
}

export const addPendingGroupDeletes = (ids: string[]) => editPendingGroupDeletes((set) => ids.forEach((id) => set.add(id)));
export const removePendingGroupDeletes = (ids: string[]) => editPendingGroupDeletes((set) => ids.forEach((id) => set.delete(id)));

/** Drops the oldest ids once the pending-delete set exceeds its cap (Set keeps insertion order). */
function capPendingDeletes(ids: Set<string>): void {
  for (const id of ids) {
    if (ids.size <= MAX_PENDING_DELETES) break;
    ids.delete(id);
  }
}

/**
 * The one place groups are persisted. In a SINGLE transaction it: checks `expectedRev`, prunes
 * missing groups, maintains the pending remote-delete set, derives `positionDirty`, writes the
 * groups + order, and bumps `rev`. Returns the state as stored (flags normalised, new `rev`).
 *
 * `positionDirty` (sidebar index changed, new `position` not on the server yet) is derived
 * HERE from the stored order, so EVERY index-shifting mutation (delete, bulk delete, star
 * re-sort, duplicate, import, a pull removing a group, undo) marks the groups it shifted with
 * no per-mutator code, and a cache-derived blind write cannot erase a flag: the stored flag is
 * OR-ed in. An incoming `positionDirty === false` is a caller's claim "already at this index on
 * the server" (a pull that adopted the remote order) and wins for that write only.
 */
async function writeGroupsState(state: GroupsState, expectedRev?: number, preserveBases = false): Promise<GroupsState> {
  const db = await getDb();
  const tx = db.transaction(['groups', 'groupsState', 'settings'], 'readwrite');
  const [stateRecord, storedGroups, pendingRecord, syncRecord] = await Promise.all([
    tx.objectStore('groupsState').get('state'),
    tx.objectStore('groups').getAll(),
    tx.objectStore('settings').get(PENDING_DELETE_KEY) as Promise<{ id: string; value: string[] } | undefined>,
    tx.objectStore('settings').get(CLOUD_SYNC_ACTIVE_KEY) as Promise<{ id: string; value: boolean } | undefined>
  ]);

  const storedRev = stateRecord?.rev ?? 0;
  if (expectedRev !== undefined && storedRev !== expectedRev) {
    await tx.done; // nothing queued: commits empty
    throw new StaleGroupsError();
  }

  const keepIds = new Set(state.available.map((g) => g.id));
  const orphanIds = storedGroups.map((g) => g.id).filter((id) => !keepIds.has(id));
  const storedById = new Map(storedGroups.map((g) => [g.id, g]));
  const prevIndex = new Map<string, number>((stateRecord?.order ?? []).map((id: string, i: number): [string, number] => [id, i]));
  const rev = storedRev + 1;

  const groups = state.available.map((g, i) => {
    const { positionDirty: claimed, remoteUpdatedAt: incomingBase, ...rest0 } = g;
    // A blind cache-derived write carries whatever base the cache held; the stored one is newer
    // (pushes update it), so it wins there. Read-modify-write callers hand over a fresh base.
    const base = preserveBases ? storedById.get(g.id)?.remoteUpdatedAt ?? incomingBase : incomingBase;
    const rest = base ? { ...rest0, remoteUpdatedAt: base } : rest0;
    if (g.permanent) return rest; // Now Open is never synced
    const dirty =
      claimed !== false && (claimed === true || storedById.get(g.id)?.positionDirty === true || prevIndex.get(g.id) !== i);
    return dirty ? { ...rest, positionDirty: true } : rest;
  });

  // Pending remote deletes move in the SAME transaction as the local removal: every group this
  // write prunes becomes "delete remotely until confirmed" (only while cloud sync is active, so
  // a signed-out / free user's deletes never pile up), and a group it (re)creates, e.g. an
  // undone delete, stops being one. A crash cannot leave a local delete without its marker.
  const pending = new Set(pendingRecord?.value ?? []);
  if (syncRecord?.value === true) orphanIds.forEach((id) => pending.add(id));
  keepIds.forEach((id) => pending.delete(id));
  capPendingDeletes(pending);

  await Promise.all([
    ...(pending.size || pendingRecord ? [tx.objectStore('settings').put({ id: PENDING_DELETE_KEY, value: [...pending] })] : []),
    ...orphanIds.map((id) => tx.objectStore('groups').delete(id)),
    ...groups.map((g) => tx.objectStore('groups').put(g)),
    tx.objectStore('groupsState').put({ id: 'state', active: state.active, order: groups.map((g) => g.id), rev }),
    tx.done
  ]);
  notifyGroupsChanged();
  return { ...state, available: groups, rev };
}

/**
 * @internal TEST-ONLY. Raw single-record write: not queued, not locked, no rev, no order. Nothing in
 * production uses it any more (every group write goes through `updateGroupsState` /
 * `saveGroupsState`); it survives for unit-test fixtures and the legacy `pullRemoteChanges`.
 */
export async function saveGroup(group: Group): Promise<void> {
  const db = await getDb();
  await db.put('groups', group);
  notifyGroupsChanged();
}

/** @internal TEST-ONLY, see {@link saveGroup}. */
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

/**
 * Clears sync flags after a successful push, as a queued step with the read and write in ONE
 * transaction. `pendingSync` is cleared only if the stored group is still the version stamped
 * `updatedAt` (an edit made while the push was in flight keeps its flag); `positionDirty` only if
 * the group is still at index `position` in the stored order (a reorder made in flight keeps it).
 */
function markPushed(id: string, pushed: { updatedAt?: number; position: number; base?: string; group?: Group }): Promise<void> {
  return enqueueGroupsWrite(async () => {
    const db = await getDb();
    const tx = db.transaction(['groups', 'groupsState'], 'readwrite');
    const [group, stateRecord] = await Promise.all([tx.objectStore('groups').get(id), tx.objectStore('groupsState').get('state')]);
    let next = group;
    // the server accepted the write: this is now the stamp the next push must compare against, even
    // if an edit made in flight keeps the group pending
    if (group && pushed.base) next = { ...group, remoteUpdatedAt: pushed.base };
    // same updatedAt AND same content: two edits inside one millisecond share an updatedAt, so the
    // timestamp alone cannot tell the pushed version from a newer one
    if (next && pushed.updatedAt !== undefined && next.updatedAt === pushed.updatedAt && next.pendingSync && (!pushed.group || groupContentEqual(next, pushed.group))) {
      next = { ...next, pendingSync: false };
    }
    if (next && next.positionDirty && stateRecord?.order?.indexOf(id) === pushed.position) {
      const { positionDirty: _cleared, ...rest } = next;
      next = rest;
    }
    await Promise.all([next && next !== group ? tx.objectStore('groups').put(next) : undefined, tx.done]);
  });
}

/** After a CONTENT push of the version `pushedUpdatedAt` that carried `pushedPosition`. */
export const markGroupSynced = (id: string, pushedUpdatedAt: number, pushedPosition: number, base?: string, pushedGroup?: Group) =>
  markPushed(id, { updatedAt: pushedUpdatedAt, position: pushedPosition, base, group: pushedGroup });

/** After a position-only push. */
export const markPositionSynced = (id: string, pushedPosition: number, base?: string) => markPushed(id, { position: pushedPosition, base });

/** Wipes local groups/sessions state — used when the signed-in Supabase account changes
 * (see useSync's last-signed-in-user check) so a different account never inherits the
 * previous account's locally-cached data (which would get pushed as "mine" and collide
 * with that account's own rows under RLS). Settings are intentionally left alone — they're
 * device-level prefs, not per-account data.
 *
 * Runs as a step of the groups write queue (bumping the write generation): a groups write
 * issued BEFORE the wipe lands first and is wiped with the rest, instead of racing the wipe
 * and re-populating the store with the previous account's groups afterwards. */
export function clearLocalAccountData(): Promise<void> {
  return enqueueGroupsWrite(async () => {
    const db = await getDb();
    const tx = db.transaction(['groups', 'groupsState', 'sessions', 'settings'], 'readwrite');
    await Promise.all([
      tx.objectStore('groups').clear(),
      tx.objectStore('groupsState').clear(),
      tx.objectStore('sessions').clear(),
      // the previous account's unconfirmed deletes must not be sent against the next account
      tx.objectStore('settings').delete(PENDING_DELETE_KEY),
      // ...nor its sync progress flags inherited by it (migrations done, bases seeded, delete backoff)
      ...ACCOUNT_SCOPED_SETTING_KEYS.map((key) => tx.objectStore('settings').delete(key)),
      tx.done
    ]);
    notifyGroupsChanged();
  });
}

/**
 * "Clear all data" from Settings: wipes every store as a QUEUED step (same ordering guarantee as
 * {@link clearLocalAccountData}), so an in-flight groups write cannot re-populate the store
 * afterwards. Keeps the `cloudSyncActive` flag, which `useSync` only writes when it changes, and
 * the store's owner (`LAST_USER_ID_KEY`): clearing the data does not change who is signed in, and
 * `ensureAccountScope` (memoised per user, so it would not record the owner again) is the only
 * writer of that key. Without it, a different account signing in next would get no wipe of what
 * this account created or pulled back since, and the worker's owner check would pass for anyone.
 */
export function clearAllLocalData(): Promise<void> {
  return enqueueGroupsWrite(async () => {
    const db = await getDb();
    const keep = new Set<string>([CLOUD_SYNC_ACTIVE_KEY, LAST_USER_ID_KEY]);
    const settingKeys = ((await db.getAllKeys('settings')) as string[]).filter((k) => !keep.has(k));
    const tx = db.transaction(['groups', 'groupsState', 'sessions', 'settings'], 'readwrite');
    await Promise.all([
      tx.objectStore('groups').clear(),
      tx.objectStore('groupsState').clear(),
      tx.objectStore('sessions').clear(),
      ...settingKeys.map((k) => tx.objectStore('settings').delete(k)),
      tx.done
    ]);
    notifyGroupsChanged();
  });
}

/** Marks every local group dirty so the next push re-sends all of them — used right after
 * encryption setup so existing Supabase rows (still plaintext) get overwritten with ciphertext.
 * Read and write share ONE transaction inside the write queue, so an edit can't slip in
 * between and be overwritten by a stale copy. */
export function markAllGroupsPendingSync(): Promise<void> {
  return enqueueGroupsWrite(async () => {
    const db = await getDb();
    const tx = db.transaction('groups', 'readwrite');
    // Now Open is device-local and never synced. NOTE: every other group becomes a full content
    // push (an unconditional upsert); a device that was offline can therefore overwrite a newer
    // remote edit. Restricting this to rows that are still plaintext/absent remotely needs a pull
    // first and is not done here.
    const all = (await tx.store.getAll()).filter((g) => !g.permanent);
    await Promise.all([
      ...all.map((g) => tx.store.put({ ...g, pendingSync: true })),
      tx.done
    ]);
  });
}
