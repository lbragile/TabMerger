import { type BrowserContext, type Page } from '@playwright/test';

/** Open the extension popup as a regular page (bypasses the 780×600 popup constraint). */
export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  return page;
}

/**
 * Seed IndexedDB with a minimal state so tests don't depend on live browser tabs.
 * Writes directly via the idb-style API that the extension already has open.
 */
export async function seedIdb(
  page: Page,
  groups: {
    id: string;
    name: string;
    color?: string;
    permanent?: boolean;
    starred?: boolean;
    windows?: {
      id: number;
      tabs: { id: number; title: string; url: string; favIconUrl?: string; ogImage?: string }[];
      incognito: boolean;
      focused: boolean;
    }[];
  }[]
) {
  await page.evaluate(async (groups) => {
    const DB_NAME = 'tabmerger';
    const DB_VERSION = 1;

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = async () => {
        const db = req.result;
        const tx = db.transaction(['groups', 'groupsState'], 'readwrite');
        const gs = tx.objectStore('groups');
        const ss = tx.objectStore('groupsState');

        for (const g of groups) {
          await gs.put({
            id: g.id,
            name: g.name,
            color: g.color ?? 'rgba(128,128,128,1)',
            updatedAt: Date.now(),
            windows: g.windows ?? [],
            permanent: g.permanent ?? false,
            starred: g.starred ?? false,
            pendingSync: false,
          });
        }

        const order = groups.map((g) => g.id);
        const activeId = groups.find((g) => g.permanent)?.id ?? groups[0].id;
        await ss.put({ id: 'state', active: { id: activeId, index: 0 }, order });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onupgradeneeded = (e) => {
        // If DB doesn't exist yet, create stores (mirrors localDb.ts upgrade)
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('groups')) {
          const s = db.createObjectStore('groups', { keyPath: 'id' });
          s.createIndex('by-updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('groupsState'))
          db.createObjectStore('groupsState', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('by-createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings'))
          db.createObjectStore('settings', { keyPath: 'id' });
      };
    });
  }, groups);
}

/** Seed state then reload popup so the app reads fresh IDB data. */
export async function seedAndReload(
  page: Page,
  groups: Parameters<typeof seedIdb>[1]
): Promise<void> {
  await seedIdb(page, groups);
  await page.reload({ waitUntil: 'networkidle' });
}
