import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import http from 'node:http';
import { webcrypto } from 'node:crypto';
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
    archived?: boolean;
    note?: string;
    /** Epoch ms. Default: the page's `Date.now()` at seeding time. */
    updatedAt?: number;
    windows?: {
      id: number;
      tabs: {
        id: number;
        title: string;
        url: string;
        favIconUrl?: string;
        ogImage?: string;
        customTitle?: string;
        note?: string;
        /** Epoch ms the tab was saved; drives the "stale tab" marker. */
        savedAt?: number;
      }[];
      incognito: boolean;
      focused: boolean;
      starred?: boolean;
      name?: string;
      note?: string;
    }[];
  }[]
) {
  await page.evaluate(async (groups) => {
    const DB_NAME = 'tabmerger';
    const DB_VERSION = 1;

    const write = () => new Promise<void>((resolve, reject) => {
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
            updatedAt: g.updatedAt ?? Date.now(),
            windows: g.windows ?? [],
            permanent: g.permanent ?? false,
            starred: g.starred ?? false,
            pendingSync: false,
            ...(g.archived ? { archived: true } : {}),
            ...(g.note ? { note: g.note } : {}),
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

    // Hold the app's own groups write lock (GROUPS_LOCK_NAME in src/lib/localDb.ts) while seeding.
    // The popup that is already open rewrites the groups state on its own (the Now Open sync on
    // mount and on every tab event) as a read-modify-write under this lock. Unlocked, a seed that
    // landed between that read and its write was overwritten and every seeded group was lost.
    if (navigator.locks?.request) await navigator.locks.request('tabmerger-groups-write', write);
    else await write();
  }, groups);
}

/**
 * Write records into the `settings` store, keyed by record id (`appSettings`, `activeGroupIndex`,
 * `urlRules`, ...). The app reads them on its next load, so call this before a reload. A partial
 * `appSettings` is fine: the app merges the stored object over its defaults.
 */
export async function seedSettings(page: Page, records: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (records) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('settings', 'readwrite');
        for (const [id, value] of Object.entries(records)) tx.objectStore('settings').put({ id, value });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, records);
}

/** A group as IndexedDB holds it (the fields tests assert on). */
export interface StoredGroup {
  id: string;
  name: string;
  color: string;
  note?: string;
  info?: string;
  starred?: boolean;
  archived?: boolean;
  permanent?: boolean;
  windows: { name?: string; note?: string; starred?: boolean; incognito?: boolean; tabs: { title: string; customTitle?: string; url: string; note?: string }[] }[];
}

/**
 * The groups as IndexedDB holds them right now, in sidebar order. Reads through its OWN
 * connection in `reader` (any page or the service worker of the extension), so it only ever
 * sees committed data and works after the popup that made the change is gone.
 */
export async function readStoredGroups(reader: Page | Worker): Promise<StoredGroup[]> {
  return reader.evaluate(
    () =>
      new Promise<StoredGroup[]>((resolve, reject) => {
        const req = indexedDB.open('tabmerger');
        // No database yet: refuse to create one (an empty version-1 database with no stores
        // would stop the app's own upgrade from ever running).
        let missing = false;
        req.onupgradeneeded = () => {
          missing = true;
          req.transaction?.abort();
        };
        req.onerror = (event: Event) => {
          if (!missing) return reject(req.error);
          event.preventDefault();
          resolve([]);
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['groups', 'groupsState'], 'readonly');
          const groups = tx.objectStore('groups').getAll();
          const state = tx.objectStore('groupsState').get('state');
          tx.oncomplete = () => {
            db.close();
            const order: string[] = state.result?.order ?? [];
            const rank = (id: string) => (order.indexOf(id) === -1 ? Number.MAX_SAFE_INTEGER : order.indexOf(id));
            resolve((groups.result as StoredGroup[]).sort((a, b) => rank(a.id) - rank(b.id)));
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        };
      })
  );
}

/**
 * Waits until IndexedDB holds the change a UI action just made. Call it before EVERY reload,
 * close or reopen of the popup that follows an action.
 *
 * Why: a group write is asynchronous (cross-context lock, fresh read, then the write
 * transaction) and the action's handler does not wait for it, so the change reaches disk a few
 * milliseconds to a few hundred milliseconds after the click, depending on how busy the machine
 * is. Playwright reloads the page within a millisecond or two of the click, faster than any
 * person can dismiss the popup, and a page that goes away takes its unfinished write with it.
 * What the UI shows is not a signal (optimistic previews render before the write), and a fixed
 * sleep is a guess: poll the store itself.
 *
 * `what` names the expected change in the failure message.
 */
export async function waitForStoredGroups(
  reader: Page | Worker,
  isStored: (groups: StoredGroup[]) => boolean,
  what: string
): Promise<void> {
  await expect
    .poll(async () => isStored(await readStoredGroups(reader)), {
      message: `IndexedDB never held: ${what}`,
      timeout: 10_000,
      intervals: [20, 50, 100, 250],
    })
    .toBe(true);
}

/** {@link waitForStoredGroups} for one group, found by name or by the predicate itself. */
export async function waitForStoredGroup(
  reader: Page | Worker,
  isStored: (group: StoredGroup) => boolean,
  what: string
): Promise<void> {
  await waitForStoredGroups(reader, (groups) => groups.some(isStored), what);
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

/** Escapes text for an HTML response body, so a request-derived value can never be read as markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const JS_LITERAL_ESCAPES: Record<string, string> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/** Serialises a value for embedding in JS source that is evaluated in the page (JSON plus the characters JSON leaves unsafe there). */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => JS_LITERAL_ESCAPES[char]);
}

/**
 * Spins up a loopback HTTP server whose page title (and body) is the last URL path segment, so
 * every real browser tab a test opens on it gets a stable, distinct row name without the
 * internet. Unlike {@link startFixtureServer}, the title comes from the request, one per path.
 * Sockets are tracked and destroyed on `close()` so teardown never waits on a keep-alive.
 */
export async function startTitleServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const title = decodeURIComponent((req.url ?? '/').split('/').pop() ?? '');
    res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
    res.end(`<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body>${escapeHtml(title)}</body></html>`);
  });
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        sockets.forEach((s) => s.destroy());
      }),
  };
}

export const E2E_USER_ID = 'e2e-user';
const E2E_USER_EMAIL = 'e2e@example.com';

/**
 * What the account's `encryption_keys` check answers for a faked Pro user:
 *  - `unlocked`: the key row exists and this device holds the data key (the steady state of a
 *    real Pro user: sync runs, no dialog);
 *  - `locked`: the key row exists but this device has not unlocked it yet (a second device or
 *    profile). The row is a real wrapped key that {@link E2E_PASSPHRASE} opens;
 *  - `none`: the server answers that the account has no key yet (first-time setup);
 *  - `error`: the request fails (HTTP 500), so the status is unknown.
 */
export type E2eEncryption = 'unlocked' | 'locked' | 'none' | 'error';

/** The passphrase that unwraps the key row served in `locked` mode. */
export const E2E_PASSPHRASE = 'e2e-passphrase';

/** An `encryption_keys` row as first-time setup stores it: a random data key wrapped with {@link E2E_PASSPHRASE}. */
async function wrappedKeyRow(): Promise<Record<string, unknown>> {
  const { subtle } = webcrypto;
  const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString('base64');
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  // The row carries its own iteration count, so a low one keeps the test fast.
  const iterations = 1000;
  const baseKey = await subtle.importKey('raw', new TextEncoder().encode(E2E_PASSPHRASE), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );
  const dataKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = await subtle.wrapKey('raw', dataKey, wrappingKey, { name: 'AES-GCM', iv });
  return { user_id: E2E_USER_ID, salt: b64(salt), wrap_iv: b64(iv), wrapped_key: b64(wrapped), kdf_iterations: iterations };
}

/**
 * Fakes a signed-in Pro account: writes a session into chrome.storage.local (the Supabase
 * storage adapter, see lib/supabase.ts) and stubs EVERY Supabase REST call, so the outcome does
 * not depend on whether a Supabase is reachable from the machine running the test, or on how
 * fast it answers. Call it, then reload the popup.
 *
 * Unstubbed, the `encryption_keys` check hit whatever VITE_SUPABASE_URL the build had: a local
 * stack answered 401 at once, an unreachable host only failed after PostgREST's retry backoff
 * (~7 s), and the test result followed that timing.
 */
export async function signInAsPro(page: Page, encryption: E2eEncryption = 'unlocked'): Promise<void> {
  // Registered first = lowest priority: any table not stubbed below reads as empty / accepts writes.
  await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/auth/v1/user*', (route) =>
    route.fulfill({ json: { id: E2E_USER_ID, email: E2E_USER_EMAIL, aud: 'authenticated' } })
  );
  await page.route('**/rest/v1/subscriptions*', (route) =>
    route.fulfill({ json: [{ tier: 'pro', status: 'active', cancel_at_period_end: false, current_period_end: null, stripe_price_id: null }] })
  );
  const keyRow = encryption === 'locked' ? await wrappedKeyRow() : { user_id: E2E_USER_ID };
  await page.route('**/rest/v1/encryption_keys*', (route) => {
    if (encryption === 'error') return route.fulfill({ status: 500, json: { message: 'e2e: encryption check failed' } });
    return route.fulfill({ json: encryption === 'none' ? [] : [keyRow] });
  });

  const session = {
    access_token: 'e2e-access-token',
    refresh_token: 'e2e-refresh-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: E2E_USER_ID, email: E2E_USER_EMAIL, aud: 'authenticated', app_metadata: {}, user_metadata: {} },
  };
  const stored: Record<string, string> = { 'tabmerger-auth': JSON.stringify(session) };
  // A raw 256-bit AES key, base64, under the key encryptionKey.ts reads (`dataKey_<userId>`).
  if (encryption === 'unlocked') stored[`dataKey_${E2E_USER_ID}`] = Buffer.alloc(32, 7).toString('base64');
  await page.evaluate(async (items) => {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set(items, () => resolve());
    });
  }, stored);
}
