import { type BrowserContext, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Open the extension popup as a regular page (bypasses the 800×600 popup constraint). */
export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
  return page;
}

/**
 * Wait until an inline rename input (tab / group / window title) is truly ready for typing.
 *
 * Entering edit mode mounts the input, then a 50ms timer focuses it and collapses the
 * selection to the end of the value. A test that clicks / presses Ctrl+A inside that window
 * has its selection collapsed by the timer, so a following Backspace deletes one character.
 * The input is never autoFocus, so "focused with the caret at the end" can only be true
 * after the timer ran. Call this BEFORE any click or keypress in the input.
 */
export async function waitForRenameInputReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const el = document.activeElement;
    return (
      el instanceof HTMLInputElement &&
      el.selectionStart === el.value.length &&
      el.selectionEnd === el.value.length
    );
  });
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

/**
 * Spins up a real loopback HTTP server serving a single HTML page with the given
 * `<title>` for every path. Used instead of navigating to a real external site
 * (e.g. github.com) so URL-rule / real-navigation tests don't depend on the public
 * internet in CI — a genuine TCP navigation (not a Playwright `route.fulfill` stub)
 * is required for the background service worker to see normal `chrome.tabs.onUpdated`
 * lifecycle events; routing/intercepting the request at the CDP level was tried and
 * broke that lifecycle (see core.spec.ts's URL-rule test comment).
 */
export async function startFixtureServer(title: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      // Without this, Chrome keeps the connection alive (HTTP keep-alive) well past the
      // single request — `server.close()` then hangs indefinitely waiting for that socket
      // to end on its own, which silently wedged this test's cleanup for the full test
      // timeout with no error surfaced. Forcing `Connection: close` makes Chrome drop the
      // socket right after this response.
      res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
      res.end(`<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`);
    });
    server.once('error', reject);
    // Belt-and-braces alongside `Connection: close` above: track every socket and destroy
    // whatever's still open when `close()` is called, so a client that ignores the header
    // (or a request still in flight) can never wedge teardown either.
    const sockets = new Set<import('node:net').Socket>();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      if (!address) { reject(new Error('fixture server failed to bind')); return; }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((res) => {
          server.close(() => res());
          sockets.forEach((s) => s.destroy());
        }),
      });
    });
  });
}
