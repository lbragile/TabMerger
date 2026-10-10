import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, readStoredGroups, startTitleServer, waitForStoredGroups } from '../helpers';

/**
 * Dragging out of Now Open MOVES: the saved group gets a copy and the real tabs close. The
 * rule under test (spec C7): only the active tab of the window the TabMerger page lives in
 * is held back, because closing it would dismiss the toolbar popup. Every other tab, its
 * window's active tab included, closes at the drop, so a window TabMerger is not in closes
 * completely and straight away.
 *
 * Here the TabMerger page is an ordinary tab, so its window is the one holding that tab.
 * Real windows are created from the service worker on a loopback server whose page title is
 * the last URL segment (stable, distinct row names, no internet). "Closed" is asserted with
 * `chrome.windows.getAll` / `chrome.tabs.query` from the service worker, never from the UI.
 */

const NOW_OPEN_PLACEHOLDER = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const TARGET = {
  id: 'closetarget1',
  name: 'Close Target',
  color: 'rgba(59,130,246,1)',
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Existing', url: 'https://existing.example.com' }] }],
};

type Server = Awaited<ReturnType<typeof startTitleServer>>;

interface RealWindow {
  id: number;
  titles: string[];
}

/** Every real browser window and the (decoded) last URL segment of each of its tabs. */
async function realWindows(sw: Worker): Promise<RealWindow[]> {
  return sw.evaluate(async () => {
    const all = await chrome.windows.getAll({ populate: true });
    return all.map((w) => ({
      id: w.id ?? -1,
      titles: (w.tabs ?? []).map((t) => {
        const url = t.url || t.pendingUrl || '';
        return url.startsWith('chrome-extension://') ? 'TabMerger' : decodeURIComponent(url.split('/').pop() ?? '');
      }),
    }));
  });
}

/** Titles of all real tabs that are named `Live ...`, as a flat sorted list. */
async function liveTitles(sw: Worker): Promise<string[]> {
  return (await realWindows(sw)).flatMap((w) => w.titles).filter((t) => t.startsWith('Live ')).sort();
}

/** Open Now Open with the given extra real windows (each a list of titles), group "Close Target" saved. */
async function openWithWindows(context: BrowserContext, extensionId: string, server: Server, windows: string[][]) {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, TARGET]);
  const [sw] = context.serviceWorkers();
  const urls = (names: string[]) => names.map((n) => `${server.base}/${encodeURIComponent(n)}`);
  await sw.evaluate(async (list: string[][]) => {
    for (const url of list) await chrome.windows.create({ url, focused: false });
  }, windows.map(urls));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Now Open', exact: true }).click();
  const last = windows.at(-1)!.at(-1)!;
  await expect(page.getByRole('listitem', { name: last })).toBeVisible({ timeout: 10_000 });
  return { page, sw };
}

/** The Now Open window card that contains a tab row named `tabName`. */
function card(page: Page, tabName: string) {
  return page
    .locator('div[data-window-index]', { has: page.getByRole('listitem', { name: tabName }) })
    .filter({ has: page.locator('[data-window-header]') });
}

const WINDOW_GRIP = '[aria-label^="Drag to reorder window"]';
const TAB_GRIP = '[aria-label^="Drag to reorder tab"]';

type Box = { x: number; y: number; width: number; height: number };
const centerOf = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Press on `grip`, start the drag, glide onto `target` (a selector or a late box lookup) and release. */
async function dragGripTo(page: Page, grip: ReturnType<Page['locator']>, target: string) {
  await grip.hover();
  const from = await grip.boundingBox();
  if (!from) throw new Error('grip has no box');
  const f = centerOf(from);
  await page.mouse.move(f.x, f.y);
  await page.mouse.down();
  await page.mouse.move(f.x, f.y + 8, { steps: 3 });
  // The drop zone only exists as a hit target once the drag is live, so measure it now.
  const toBox = await page.locator(target).boundingBox();
  if (!toBox) throw new Error(`no box for ${target}`);
  const t = centerOf(toBox);
  await page.mouse.move(t.x, t.y, { steps: 14 });
  await page.mouse.up();
}

/** The target group's saved windows as arrays of tab titles, from IndexedDB. */
async function targetWindows(page: Page): Promise<string[][]> {
  const group = (await readStoredGroups(page)).find((g) => g.id === 'closetarget1')!;
  return group.windows.map((w) => w.tabs.map((t) => t.title));
}

const TARGET_ROW = '[data-sidebar-group-index="1"]';

test.describe('Now Open drag-out closes the real tabs (spec C7)', () => {
  test('a window in another browser window dropped on a group row closes completely and the group holds the copy', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(context, extensionId, server, [
        ['Live A1', 'Live A2'],
        ['Live B1', 'Live B2', 'Live B3'],
      ]);
      const windowsBefore = await realWindows(sw);
      const aWindow = windowsBefore.find((w) => w.titles.includes('Live A1'))!;
      expect(aWindow.titles).toEqual(['Live A1', 'Live A2']);

      await dragGripTo(page, card(page, 'Live A1').locator(WINDOW_GRIP), TARGET_ROW);

      // The whole window is gone, not just its non-active tab.
      await expect.poll(async () => (await realWindows(sw)).some((w) => w.id === aWindow.id), { timeout: 10_000 }).toBe(false);
      expect(await liveTitles(sw)).toEqual(['Live B1', 'Live B2', 'Live B3']);
      // The TabMerger page's own window and the untouched window are still open.
      const after = await realWindows(sw);
      expect(after.some((w) => w.titles.includes('TabMerger'))).toBe(true);
      expect(after.find((w) => w.titles.includes('Live B1'))!.titles).toEqual(['Live B1', 'Live B2', 'Live B3']);

      await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'closetarget1')?.windows.length === 2, 'Close Target holding 2 windows');
      expect(await targetWindows(page)).toEqual([['Existing'], ['Live A1', 'Live A2']]);
      expect(page.isClosed()).toBe(false);
      await expect(page.getByRole('listitem', { name: 'Live A1' })).toHaveCount(0);
      await expect(page.getByRole('listitem', { name: 'Live B3' })).toBeVisible();
    } finally {
      await server.close();
    }
  });

  test('the same drag onto the "Drop for a new group" zone closes the window completely and creates the group', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(context, extensionId, server, [
        ['Live A1', 'Live A2'],
        ['Live B1', 'Live B2', 'Live B3'],
      ]);
      const bWindow = (await realWindows(sw)).find((w) => w.titles.includes('Live B1'))!;

      await dragGripTo(page, card(page, 'Live B1').locator(WINDOW_GRIP), '[data-testid="new-group-dropzone"]');

      await expect.poll(async () => (await realWindows(sw)).some((w) => w.id === bWindow.id), { timeout: 10_000 }).toBe(false);
      expect(await liveTitles(sw)).toEqual(['Live A1', 'Live A2']);

      await waitForStoredGroups(
        page,
        (groups) => groups.some((g) => g.windows.some((w) => w.tabs.map((t) => t.title).join() === 'Live B1,Live B2,Live B3')),
        'a new group holding the dragged window'
      );
      const groups = await readStoredGroups(page);
      expect(groups.filter((g) => !g.permanent)).toHaveLength(2);
      const created = groups.find((g) => g.id !== 'closetarget1' && !g.permanent)!;
      expect(created.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['Live B1', 'Live B2', 'Live B3']]);
      expect(page.isClosed()).toBe(false);
    } finally {
      await server.close();
    }
  });

  test('a multi-window selection of two other windows closes both completely; a third window is left alone', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(context, extensionId, server, [
        ['Live A1', 'Live A2'],
        ['Live B1', 'Live B2'],
        ['Live C1', 'Live C2'],
      ]);
      await page.getByRole('button', { name: 'Select items' }).click();
      for (const name of ['Live A1', 'Live B1']) {
        await card(page, name).locator('[data-window-header]').getByRole('checkbox', { name: /^Select / }).click();
      }
      await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);

      await dragGripTo(page, card(page, 'Live A1').locator(WINDOW_GRIP), TARGET_ROW);

      await expect.poll(async () => liveTitles(sw), { timeout: 10_000 }).toEqual(['Live C1', 'Live C2']);
      const after = await realWindows(sw);
      expect(after.some((w) => w.titles.includes('Live A1') || w.titles.includes('Live B1'))).toBe(false);
      expect(after.find((w) => w.titles.includes('Live C1'))!.titles).toEqual(['Live C1', 'Live C2']);

      await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'closetarget1')?.windows.length === 3, 'Close Target holding 3 windows');
      const copied = (await targetWindows(page)).slice(1).map((w) => w.join()).sort();
      expect(copied).toEqual(['Live A1,Live A2', 'Live B1,Live B2']);
      expect(page.isClosed()).toBe(false);
    } finally {
      await server.close();
    }
  });

  test("a window's active tab dragged alone closes at once, and its other tabs stay open", async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(context, extensionId, server, [['Live D1', 'Live D2', 'Live D3']]);
      // The first URL of a new window is its active tab.
      const activeTitles = await sw.evaluate(async () =>
        (await chrome.tabs.query({ active: true })).map((t) => decodeURIComponent((t.url ?? '').split('/').pop() ?? ''))
      );
      expect(activeTitles).toContain('Live D1');

      await dragGripTo(page, page.getByRole('listitem', { name: 'Live D1' }).locator(TAB_GRIP), TARGET_ROW);

      await expect.poll(async () => liveTitles(sw), { timeout: 10_000 }).toEqual(['Live D2', 'Live D3']);
      await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'closetarget1')?.windows.length === 2, 'Close Target holding 2 windows');
      expect((await targetWindows(page)).at(-1)).toEqual(['Live D1']);
      expect(page.isClosed()).toBe(false);
    } finally {
      await server.close();
    }
  });

  test('dragging the window that holds the TabMerger tab closes its other tabs and leaves the window open with only the TabMerger tab', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      // Pages opened in the TabMerger page's own window BEFORE it is brought to the front.
      const own1 = await context.newPage();
      await own1.goto(`${server.base}/${encodeURIComponent('Live Own1')}`);
      const own2 = await context.newPage();
      await own2.goto(`${server.base}/${encodeURIComponent('Live Own2')}`);
      const { page, sw } = await openWithWindows(context, extensionId, server, [['Live Far1', 'Live Far2']]);
      await page.bringToFront();

      const own = (await realWindows(sw)).find((w) => w.titles.includes('TabMerger'))!;
      expect(own.titles).toEqual(expect.arrayContaining(['Live Own1', 'Live Own2', 'TabMerger']));
      const ownWindowId = own.id;

      await dragGripTo(page, card(page, 'Live Own1').locator(WINDOW_GRIP), TARGET_ROW);

      // Everything Now Open held in that window closes at the drop...
      await expect.poll(async () => (await liveTitles(sw)).filter((t) => t.startsWith('Live Own')), { timeout: 10_000 }).toEqual([]);
      // ...but the window stays, holding only the TabMerger tab, and the page is alive.
      const after = (await realWindows(sw)).find((w) => w.id === ownWindowId);
      expect(after?.titles).toEqual(['TabMerger']);
      expect(page.isClosed()).toBe(false);
      // The other window was not touched.
      expect((await realWindows(sw)).find((w) => w.titles.includes('Live Far1'))?.titles).toEqual(['Live Far1', 'Live Far2']);

      await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'closetarget1')?.windows.length === 2, 'Close Target holding 2 windows');
      const copy = (await targetWindows(page)).at(-1)!;
      expect(copy).toEqual(expect.arrayContaining(['Live Own1', 'Live Own2']));
      expect(copy).not.toContain('TabMerger');
    } finally {
      await server.close();
    }
  });
});
