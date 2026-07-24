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

export async function getGroupsState(): Promise<GroupsState> {
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
    const nowOpen = createNowOpenGroup();
    await saveGroupsState({
      active: { id: nowOpen.id, index: 0 },
      available: [nowOpen]
    });
    return { active: { id: nowOpen.id, index: 0 }, available: [nowOpen] };
  }

  const active = stateRecord?.active ?? { id: sorted[0].id, index: 0 };
  return { active, available: sorted };
}

export async function saveGroupsState(state: GroupsState): Promise<void> {
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
}

export async function saveGroup(group: Group): Promise<void> {
  const db = await getDb();
  await db.put('groups', group);
}

export async function deleteGroup(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('groups', id);
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
  return record !== undefined ? (record as { id: string; value: T }).value : defaultValue;
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
