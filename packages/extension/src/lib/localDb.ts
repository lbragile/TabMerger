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
    value: { id: 'state'; active: GroupsState['active'] };
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

  // Sort groups: permanent first, then by updatedAt desc
  const sorted = allGroups.sort((a, b) => {
    if (a.permanent && !b.permanent) return -1;
    if (!a.permanent && b.permanent) return 1;
    return b.updatedAt - a.updatedAt;
  });

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
  const tx = db.transaction(['groups', 'groupsState'], 'readwrite');

  const groupsStore = tx.objectStore('groups');
  const stateStore = tx.objectStore('groupsState');

  // Save all groups
  await Promise.all(state.available.map((g) => groupsStore.put(g)));

  // Save active state
  await stateStore.put({ id: 'state', active: state.active });

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
