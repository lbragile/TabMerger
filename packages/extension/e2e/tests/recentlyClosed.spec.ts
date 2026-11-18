import type { BrowserContext, Page, Worker } from '@playwright/test';
import { RECENTLY_CLOSED_META_ID } from '@tabmerger/shared';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, startTitleServer, waitForStoredGroups, readStoredGroups } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * "Remember closed tabs": the background worker records the tabs and windows the user closes into
 * a device-local list (IndexedDB store `recentlyClosed`). The list UI is not built yet, so the
 * recording is asserted through the data layer (a read of that store from the service worker) and
 * through Settings > Data (the switch, the "N in the list" summary, Clear list, Undo).
 *
 * Real windows are created from the service worker on a loopback server whose page title is the
 * last URL segment. A "user" close is `chrome.tabs.remove` / `chrome.windows.remove` made from
 * the service worker, which is what the worker sees when the user closes a tab or window. Whatever
 * TabMerger closes itself after saving it (drag-out of Now Open) must NOT be recorded.
 */

type Server = Awaited<ReturnType<typeof startTitleServer>>;

interface StoredEntry {
  id: string;
  kind: 'tab' | 'window';
  clearedAt?: number;
  tabs: { url: string; title: string; pinned?: boolean }[];
}

/** The list as stored (cleared entries left out unless asked), newest first. */
async function readClosed(reader: Page | Worker, includeCleared = false): Promise<StoredEntry[]> {
  const all = await reader.evaluate(
    () =>
      new Promise<StoredEntry[]>((resolve, reject) => {
        const req = indexedDB.open('tabmerger');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('recentlyClosed')) {
            db.close();
            resolve([]);
            return;
          }
          const get = db.transaction('recentlyClosed', 'readonly').objectStore('recentlyClosed').getAll();
          get.onsuccess = () => {
            db.close();
            resolve(get.result as StoredEntry[]);
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
  // the store also holds ONE meta row (the switch and the last full clear): never an entry
  return all.filter((e) => e.id !== RECENTLY_CLOSED_META_ID && (includeCleared || e.clearedAt === undefined));
}

const lastSegment = (url: string) => decodeURIComponent(url.split('/').pop() ?? '');
const titlesOf = (e: StoredEntry) => e.tabs.map((t) => lastSegment(t.url));

/** Opens a window per list of titles from the service worker and waits until each page has loaded. */
async function openWindows(sw: Worker, server: Server, windows: string[][]): Promise<number[]> {
  const ids = await sw.evaluate(
    async ({ lists, base }: { lists: string[][]; base: string }) => {
      const out: number[] = [];
      for (const names of lists) {
        const win = await chrome.windows.create({ url: names.map((n) => `${base}/${encodeURIComponent(n)}`), focused: false });
        out.push(win!.id!);
      }
      return out;
    },
    { lists: windows, base: server.base }
  );
  const wanted = windows.flat();
  await expect
    .poll(
      async () =>
        sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => t.status === 'complete' && /127\.0\.0\.1|localhost/.test(t.url ?? '')).length),
      { timeout: 15_000 }
    )
    .toBe(wanted.length);
  // let the worker's snapshot cache see every tab
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  return ids;
}

async function tabIdByTitle(sw: Worker, title: string): Promise<number> {
  const id = await sw.evaluate(async (name: string) => {
    const tab = (await chrome.tabs.query({})).find((t) => decodeURIComponent((t.url ?? '').split('/').pop() ?? '') === name);
    return tab?.id ?? -1;
  }, title);
  expect(id, `tab ${title}`).toBeGreaterThan(-1);
  return id;
}

async function openDataTab(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: /^data$/i }).click();
}

const section = (page: Page) => page.getByTestId('recently-closed-settings');
const toggle = (page: Page) => section(page).getByRole('switch', { name: 'Remember closed tabs' });

async function setup(context: BrowserContext, extensionId: string) {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  const [sw] = context.serviceWorkers();
  return { page, sw };
}

test.describe('Recently closed: recording', () => {
  test('Settings > Data: Remember closed tabs is on by default, with the plan retention line and Clear list disabled at 0', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId);
    await openDataTab(page);
    await expect(section(page).getByRole('heading', { level: 3, name: 'Remember closed tabs' })).toBeVisible();
    await expect(toggle(page)).toBeChecked();
    await expect(page.getByTestId('recently-closed-summary')).toContainText('Your plan keeps your last 2 days · 0 in the list');
    await expect(section(page).getByRole('button', { name: 'Clear list' })).toBeDisabled();
  });

  test('closing a tab records one tab entry; the summary counts it', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId);
      await openWindows(sw, server, [['Closed A1', 'Closed A2']]);
      const id = await tabIdByTitle(sw, 'Closed A2');
      await sw.evaluate((tabId: number) => chrome.tabs.remove(tabId), id);

      await expect.poll(async () => (await readClosed(sw)).map(titlesOf), { timeout: 10_000 }).toEqual([['Closed A2']]);
      const [entry] = await readClosed(sw);
      expect(entry.kind).toBe('tab');
      expect(entry.tabs[0].url).toContain(`${server.base}/Closed%20A2`);

      await openDataTab(page);
      await expect(page.getByTestId('recently-closed-summary')).toContainText('1 in the list');
    } finally {
      await server.close();
    }
  });

  test('closing a whole window records ONE window entry with its tabs in order', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { sw } = await setup(context, extensionId);
      const [winId] = await openWindows(sw, server, [['Win P1', 'Win P2', 'Win P3']]);
      await sw.evaluate((id: number) => chrome.windows.remove(id), winId);

      await expect.poll(async () => (await readClosed(sw)).length, { timeout: 10_000 }).toBe(1);
      // give a late second write the chance to show up: still exactly one entry
      await sw.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
      const entries = await readClosed(sw);
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('window');
      expect(titlesOf(entries[0])).toEqual(['Win P1', 'Win P2', 'Win P3']);
    } finally {
      await server.close();
    }
  });

  // Chrome un-pins a window's pinned tabs (tabs.onUpdated { pinned: false }) right before closing
  // the window: the recorder counts a tab un-pinned that shortly before its close as pinned.
  test('closing a window keeps the pinned flag of its pinned tab', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { sw } = await setup(context, extensionId);
      const [winId] = await openWindows(sw, server, [['Pin Q1', 'Pin Q2']]);
      const pinnedId = await tabIdByTitle(sw, 'Pin Q1');
      await sw.evaluate((tabId: number) => chrome.tabs.update(tabId, { pinned: true }), pinnedId);
      await sw.evaluate(() => new Promise((r) => setTimeout(r, 600)));
      await sw.evaluate((id: number) => chrome.windows.remove(id), winId);
      await expect.poll(async () => (await readClosed(sw)).length, { timeout: 10_000 }).toBe(1);
      expect((await readClosed(sw))[0].tabs[0].pinned).toBe(true);
    } finally {
      await server.close();
    }
  });

  test('a private window is not recorded where the browser lets the harness open one', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { sw } = await setup(context, extensionId);
      const winId = await sw.evaluate(async (base: string) => {
        try {
          const win = await chrome.windows.create({ url: `${base}/Private%20One`, incognito: true, focused: false });
          return win?.id ?? -1;
        } catch {
          return -1;
        }
      }, server.base);
      test.skip(winId < 0, 'this browser build does not open a private window here');
      await sw.evaluate(() => new Promise((r) => setTimeout(r, 800)));
      await sw.evaluate((id: number) => chrome.windows.remove(id), winId);
      await sw.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
      expect((await readClosed(sw)).flatMap(titlesOf)).not.toContain('Private One');
    } finally {
      await server.close();
    }
  });

  test('a drag-out of Now Open (saved into a group, then closed by TabMerger) is NOT recorded', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const target = {
        id: 'rctarget0001',
        name: 'Drop Target',
        color: 'rgba(59,130,246,1)',
        windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Existing', url: 'https://existing.example.com' }] }],
      };
      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [{ id: 'now-open', name: 'Now Open', permanent: true, windows: [] }, target] as Parameters<typeof seedAndReload>[1]);
      const [sw] = context.serviceWorkers();
      await openWindows(sw, server, [['Drag D1', 'Drag D2']]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Now Open', exact: true }).click();
      await expect(page.getByRole('listitem', { name: 'Drag D2' })).toBeVisible({ timeout: 10_000 });

      const grip = page
        .locator('div[data-window-index]', { has: page.getByRole('listitem', { name: 'Drag D1' }) })
        .filter({ has: page.locator('[data-window-header]') })
        .locator('[aria-label^="Drag to reorder window"]');
      await grip.hover();
      const from = (await grip.boundingBox())!;
      const fx = from.x + from.width / 2;
      const fy = from.y + from.height / 2;
      await page.mouse.move(fx, fy);
      await page.mouse.down();
      await page.mouse.move(fx, fy + 8, { steps: 3 });
      const to = (await page.locator('[data-sidebar-group-index="1"]').boundingBox())!;
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
      await page.mouse.up();

      await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'rctarget0001')?.windows.length === 2, 'Drop Target holding the dropped window');
      await expect
        .poll(async () => sw.evaluate(async () => (await chrome.tabs.query({})).some((t) => (t.url ?? '').includes('Drag%20D1'))), { timeout: 10_000 })
        .toBe(false);
      // past the worker's window flush delay: nothing was recorded
      await sw.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
      expect((await readClosed(sw)).flatMap(titlesOf)).toEqual([]);
      expect((await readStoredGroups(page)).find((g) => g.id === 'rctarget0001')?.windows).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
});

test.describe('Recently closed: Settings > Data', () => {
  async function withTwoClosed(context: BrowserContext, extensionId: string, server: Server) {
    const { page, sw } = await setup(context, extensionId);
    await openWindows(sw, server, [['List L1', 'List L2', 'List L3']]);
    for (const name of ['List L1', 'List L2']) {
      const id = await tabIdByTitle(sw, name);
      await sw.evaluate((tabId: number) => chrome.tabs.remove(tabId), id);
    }
    await expect.poll(async () => (await readClosed(sw)).length, { timeout: 10_000 }).toBe(2);
    await openDataTab(page);
    await expect(page.getByTestId('recently-closed-summary')).toContainText('2 in the list');
    return { page, sw };
  }

  test('Clear list hides every entry at once, Undo brings them back', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await withTwoClosed(context, extensionId, server);
      await section(page).getByRole('button', { name: 'Clear list' }).click();
      await expect(page.getByText('Cleared 2 closed tabs and windows')).toBeVisible();
      await expect(page.getByTestId('recently-closed-summary')).toContainText('0 in the list');
      await expect(section(page).getByRole('button', { name: 'Clear list' })).toBeDisabled();
      expect(await readClosed(sw)).toHaveLength(0);

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByTestId('recently-closed-summary')).toContainText('2 in the list');
      expect(await readClosed(sw)).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  test('turning it off clears the list and stops recording; Undo turns it back on with the entries', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await withTwoClosed(context, extensionId, server);
      await toggle(page).click();
      await expect(toggle(page)).not.toBeChecked();
      await expect(page.getByText('Turned off · cleared 2 closed tabs and windows')).toBeVisible();
      await expect(page.getByTestId('recently-closed-summary')).toContainText('Remembering closed tabs is off.');
      await expect(section(page).getByRole('button', { name: 'Clear list' })).toHaveCount(0);
      expect(await readClosed(sw)).toHaveLength(0);

      // while it is off a close is not recorded
      const id = await tabIdByTitle(sw, 'List L3');
      await sw.evaluate((tabId: number) => chrome.tabs.remove(tabId), id);
      await sw.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
      expect(await readClosed(sw)).toHaveLength(0);

      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(toggle(page)).toBeChecked();
      await expect(page.getByTestId('recently-closed-summary')).toContainText('2 in the list');
      expect((await readClosed(sw)).map((e) => titlesOf(e)[0]).sort()).toEqual(['List L1', 'List L2']);
    } finally {
      await server.close();
    }
  });

  test('the switch survives a reload', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId);
    await openDataTab(page);
    await toggle(page).click();
    await expect(toggle(page)).not.toBeChecked();
    // saved at once: poll the stored setting before reloading
    await expect
      .poll(async () =>
        page.evaluate(
          (metaId: string) =>
            new Promise<boolean | null>((resolve) => {
              const req = indexedDB.open('tabmerger');
              req.onsuccess = () => {
                // the switch lives in the recently-closed store's meta row
                const get = req.result.transaction('recentlyClosed', 'readonly').objectStore('recentlyClosed').get(metaId);
                get.onsuccess = () => {
                  req.result.close();
                  resolve((get.result?.remember as boolean | undefined) ?? null);
                };
              };
            }),
          RECENTLY_CLOSED_META_ID
        )
      )
      .toBe(false);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    await expect(toggle(page)).not.toBeChecked();
  });
});
