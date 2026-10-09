import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, readStoredGroups, waitForStoredGroups } from '../helpers';

/**
 * Three rules, driven end to end with REAL browser windows (Now Open is rebuilt from the live
 * browser, so a seeded Now Open would be overwritten):
 *
 *  1. Only Now Open closes browser tabs. Closing a Now Open tab or window closes exactly those
 *     browser tabs; removing a saved window, by its menu or by the selection bar, closes none.
 *  2. Saved copies are detached. Whatever stores Now Open content in a saved group (selection bar
 *     "Copy to group", "Replace with current", "Merge with current") writes tab id 0 and window
 *     id 0, without the live `pinned` flag, and leaves the real tabs open.
 *  3. Duplicates are matched by position. "Deduplicate tabs" on a saved group removes only the
 *     duplicate tab; every other tab and window stays and no browser tab closes.
 *  4. The selection bar's group menu works with the mouse. A click on "Copy to group" (Now Open)
 *     or "Move to group" (a saved group) opens the menu with the selection intact, and choosing a
 *     group acts on the ticked items. A click on empty space closes the menu and keeps the
 *     selection; the next click on empty space leaves selection mode.
 *
 * Real windows are created from the service worker on a loopback server whose page title is the
 * last URL segment (stable, distinct row names, no internet). "Open" is asserted with
 * `chrome.tabs.query` from the service worker, never from the UI.
 */

const NOW_OPEN_PLACEHOLDER = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const TARGET = {
  id: 'copytarget2',
  name: 'Copy Target',
  color: 'rgba(59,130,246,1)',
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Existing', url: 'https://existing.example.com' }] }],
};
const SAVED = {
  id: 'savedset001',
  name: 'Saved Set',
  color: 'rgba(16,185,129,1)',
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Old One', url: 'https://old.example.com' }] }],
};

async function startTitleServer() {
  const server = http.createServer((req, res) => {
    const title = decodeURIComponent((req.url ?? '/').split('/').pop() ?? '');
    res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
    res.end(`<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`);
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

type Server = Awaited<ReturnType<typeof startTitleServer>>;

/** Sorted titles of the real browser tabs named `Live ...`. */
async function liveTitles(sw: Worker): Promise<string[]> {
  return sw.evaluate(async () =>
    (await chrome.tabs.query({}))
      .map((t) => decodeURIComponent((t.url || t.pendingUrl || '').split('/').pop() ?? ''))
      .filter((t) => t.startsWith('Live '))
      .sort()
  );
}

/** Number of real browser tabs of every kind. */
async function tabCount(sw: Worker): Promise<number> {
  return sw.evaluate(async () => (await chrome.tabs.query({})).length);
}

/** Open the popup with `groups` saved and the given real windows (lists of titles) open. */
async function openWithWindows(
  context: BrowserContext,
  extensionId: string,
  server: Server,
  saved: unknown[],
  windows: string[][],
  pinned: string[] = []
) {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, ...saved] as Parameters<typeof seedAndReload>[1]);
  const [sw] = context.serviceWorkers();
  const urls = (names: string[]) => names.map((n) => `${server.base}/${encodeURIComponent(n)}`);
  await sw.evaluate(async (list: string[][]) => {
    for (const url of list) await chrome.windows.create({ url, focused: false });
  }, windows.map(urls));
  for (const name of pinned) {
    await sw.evaluate(async (url: string) => {
      const [t] = await chrome.tabs.query({ url });
      if (t?.id) await chrome.tabs.update(t.id, { pinned: true });
    }, urls([name])[0]);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Now Open', exact: true }).click();
  const last = windows.at(-1)!.at(-1)!;
  await expect(page.getByRole('listitem', { name: last })).toBeVisible({ timeout: 10_000 });
  return { page, sw };
}

/** The window card (in whichever group is showing) that contains a tab row named `tabName`. */
function card(page: Page, tabName: string) {
  return page
    .locator('div[data-window-index]', { has: page.getByRole('listitem', { name: tabName }) })
    .filter({ has: page.locator('[data-window-header]') });
}

/** A stored tab as IndexedDB holds it (fields beyond the helper's typed subset). */
interface RawTab {
  id?: number;
  title: string;
  url: string;
  pinned?: boolean;
  savedAt?: number;
}
interface RawWindow {
  id?: number;
  focused?: boolean;
  starred?: boolean;
  tabs: RawTab[];
}

async function storedWindows(page: Page, groupId: string): Promise<RawWindow[]> {
  const group = (await readStoredGroups(page)).find((g) => g.id === groupId);
  return (group?.windows ?? []) as unknown as RawWindow[];
}

/** Every saved copy is detached: tab id 0 with a stamp and no `pinned`, window id 0 and unfocused. */
function expectDetached(windows: RawWindow[]) {
  for (const w of windows) {
    expect(w.id).toBe(0);
    expect(w.focused).toBe(false);
    for (const t of w.tabs) {
      expect(t.id).toBe(0);
      expect(typeof t.savedAt).toBe('number');
      expect(t).not.toHaveProperty('pinned');
    }
  }
}

async function tickWindow(page: Page, tabName: string) {
  await card(page, tabName).locator('[data-window-header]').getByRole('checkbox', { name: /^Select / }).click();
}

test.describe('Only Now Open closes browser tabs', () => {
  test('closing a Now Open tab and a Now Open window closes exactly those browser tabs', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(context, extensionId, server, [], [
        ['Live D1', 'Live D2', 'Live D3'],
        ['Live E1', 'Live E2'],
      ]);
      expect(await liveTitles(sw)).toEqual(['Live D1', 'Live D2', 'Live D3', 'Live E1', 'Live E2']);

      // One tab: hover its row, press the close button.
      const row = page.getByRole('listitem', { name: 'Live D2' });
      await row.hover();
      await row.getByRole('button', { name: 'Close tab' }).click();
      await expect.poll(() => liveTitles(sw), { timeout: 10_000 }).toEqual(['Live D1', 'Live D3', 'Live E1', 'Live E2']);

      // One window: its menu's "Close window" closes all of its tabs and none of the others.
      await card(page, 'Live E1').locator('[data-window-header]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Close window' }).click();
      await expect.poll(() => liveTitles(sw), { timeout: 10_000 }).toEqual(['Live D1', 'Live D3']);
      expect(page.isClosed()).toBe(false);
    } finally {
      await server.close();
    }
  });
});

test.describe('Selection bar "Copy to group" from Now Open', () => {
  test('stores detached copies, leaves every real tab open, and removing the saved windows closes no browser tab', async ({
    context,
    extensionId,
  }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(
        context,
        extensionId,
        server,
        [TARGET],
        [
          ['Live A1', 'Live A2'],
          ['Live B1', 'Live B2', 'Live B3'],
        ],
        ['Live A1']
      );
      const liveBefore = ['Live A1', 'Live A2', 'Live B1', 'Live B2', 'Live B3'];
      expect(await liveTitles(sw)).toEqual(liveBefore);
      const tabsBefore = await tabCount(sw);
      // The live tab is pinned, so a copy that kept the flag would show it.
      expect(await sw.evaluate(async () => (await chrome.tabs.query({ pinned: true })).length)).toBe(1);

      // Tick both windows and copy them into "Copy Target" from the selection bar.
      await page.getByRole('button', { name: 'Select items' }).click();
      await tickWindow(page, 'Live A1');
      await tickWindow(page, 'Live B1');
      // Opens the menu from the keyboard.
      await page.getByRole('button', { name: 'Copy to group' }).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('menuitem', { name: 'Copy Target', exact: true }).click();

      await waitForStoredGroups(
        page,
        (groups) => groups.find((g) => g.id === 'copytarget2')?.windows.length === 3,
        'Copy Target holding 3 windows'
      );
      const all = await storedWindows(page, 'copytarget2');
      const copied = all.filter((w) => w.tabs.some((t) => t.title.startsWith('Live ')));
      expect(all.some((w) => w.tabs.some((t) => t.title === 'Existing'))).toBe(true);
      expect(copied.map((w) => w.tabs.map((t) => t.title)).sort()).toEqual([
        ['Live A1', 'Live A2'],
        ['Live B1', 'Live B2', 'Live B3'],
      ]);
      expectDetached(copied);
      // Nothing was closed, and the copies did not change what is open.
      await page.waitForTimeout(500);
      expect(await liveTitles(sw)).toEqual(liveBefore);
      expect(await tabCount(sw)).toBe(tabsBefore);

      // Remove one saved window from its menu.
      await page.getByRole('button', { name: 'Copy Target', exact: true }).click();
      await expect(page.getByRole('listitem', { name: 'Live A1' })).toBeVisible();
      await card(page, 'Live A1').locator('[data-window-header]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Remove window' }).click();
      await waitForStoredGroups(
        page,
        (groups) => groups.find((g) => g.id === 'copytarget2')?.windows.length === 2,
        'Copy Target holding 2 windows'
      );
      await page.waitForTimeout(500);
      expect(await liveTitles(sw)).toEqual(liveBefore);

      // Remove the other copy with the selection bar's Delete.
      await page.getByRole('button', { name: 'Select items' }).click();
      await tickWindow(page, 'Live B1');
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await waitForStoredGroups(
        page,
        (groups) => {
          const g = groups.find((x) => x.id === 'copytarget2');
          return g?.windows.length === 1 && g.windows[0].tabs[0].title === 'Existing';
        },
        'Copy Target holding only its Existing window'
      );
      await page.waitForTimeout(500);
      expect(await liveTitles(sw)).toEqual(liveBefore);
      expect(await tabCount(sw)).toBe(tabsBefore);
      expect(page.isClosed()).toBe(false);
    } finally {
      await server.close();
    }
  });
});

test.describe('Selection bar group menu opened with the mouse', () => {
  const MOVE_SOURCE = {
    id: 'movesource1',
    name: 'Move Source',
    color: 'rgba(16,185,129,1)',
    windows: [
      { id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Keep One', url: 'https://keep.example.com' }] },
      {
        id: 0,
        incognito: false,
        focused: false,
        tabs: [
          { id: 0, title: 'Go One', url: 'https://go-one.example.com' },
          { id: 0, title: 'Go Two', url: 'https://go-two.example.com' },
        ],
      },
    ],
  };

  /** Ticked selection checkboxes, counted in the DOM (an open menu hides the page behind it from role queries). */
  const ticked = (page: Page) => page.locator('[role="checkbox"][aria-checked="true"]');
  const selectionBar = (page: Page) => page.locator('[data-selection-action-bar]');

  /** Selection mode is over: no bar, no checkboxes, and the header offers to start a new selection. */
  async function expectSelectionModeEnded(page: Page) {
    await expect(selectionBar(page)).toHaveCount(0);
    await expect(page.locator('[role="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select items' })).toBeVisible();
  }

  /** Open the popup on "Move Source" in selection mode with its "Go One" window ticked. */
  async function openMoveSourceWithTick(context: BrowserContext, extensionId: string) {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, MOVE_SOURCE, TARGET] as Parameters<typeof seedAndReload>[1]);
    await page.getByRole('button', { name: 'Move Source', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Go One' })).toBeVisible();
    await page.getByRole('button', { name: 'Select items' }).click();
    await tickWindow(page, 'Go One');
    await expect(ticked(page)).toHaveCount(1);
    return page;
  }

  test('Now Open: a mouse click on "Copy to group" opens the menu, and the chosen group gets detached copies while every real tab stays open', async ({
    context,
    extensionId,
  }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await openWithWindows(context, extensionId, server, [TARGET], [['Live M1', 'Live M2'], ['Live N1']]);
      const liveBefore = ['Live M1', 'Live M2', 'Live N1'];
      expect(await liveTitles(sw)).toEqual(liveBefore);
      const tabsBefore = await tabCount(sw);

      await page.getByRole('button', { name: 'Select items' }).click();
      await tickWindow(page, 'Live M1');
      await expect(ticked(page)).toHaveCount(1);

      // Opens the menu with the mouse: the selection is still there to act on.
      await page.getByRole('button', { name: 'Copy to group' }).click();
      const item = page.getByRole('menuitem', { name: 'Copy Target', exact: true });
      await expect(item).toBeVisible();
      await expect(ticked(page)).toHaveCount(1);
      await expect(selectionBar(page)).toHaveCount(1);
      await item.click();

      await waitForStoredGroups(
        page,
        (groups) => groups.find((g) => g.id === 'copytarget2')?.windows.length === 2,
        'Copy Target holding 2 windows'
      );
      const all = await storedWindows(page, 'copytarget2');
      const copied = all.filter((w) => w.tabs.some((t) => t.title.startsWith('Live ')));
      expect(all.some((w) => w.tabs.some((t) => t.title === 'Existing'))).toBe(true);
      expect(copied.map((w) => w.tabs.map((t) => t.title))).toEqual([['Live M1', 'Live M2']]);
      expectDetached(copied);
      // The action is done, so selection mode is over.
      await expectSelectionModeEnded(page);
      // A copy closes nothing.
      await page.waitForTimeout(500);
      expect(await liveTitles(sw)).toEqual(liveBefore);
      expect(await tabCount(sw)).toBe(tabsBefore);
      expect(page.isClosed()).toBe(false);
    } finally {
      await server.close();
    }
  });

  test('saved group: a mouse click on "Move to group" opens the menu, and the ticked window moves to the chosen group', async ({
    context,
    extensionId,
  }) => {
    const page = await openMoveSourceWithTick(context, extensionId);
    const [sw] = context.serviceWorkers();
    const tabsBefore = await tabCount(sw);

    await page.getByRole('button', { name: 'Move to group' }).click();
    const item = page.getByRole('menuitem', { name: 'Copy Target', exact: true });
    await expect(item).toBeVisible();
    await expect(ticked(page)).toHaveCount(1);
    await expect(selectionBar(page)).toHaveCount(1);
    await item.click();

    await waitForStoredGroups(
      page,
      (groups) =>
        groups.find((g) => g.id === 'movesource1')?.windows.length === 1 &&
        groups.find((g) => g.id === 'copytarget2')?.windows.length === 2,
      'Move Source holding 1 window and Copy Target holding 2'
    );
    const source = await storedWindows(page, 'movesource1');
    expect(source.map((w) => w.tabs.map((t) => t.title))).toEqual([['Keep One']]);
    const target = await storedWindows(page, 'copytarget2');
    expect(target.map((w) => w.tabs.map((t) => t.title)).sort()).toEqual([['Existing'], ['Go One', 'Go Two']]);
    // The move is done, so selection mode is over and the moved rows are gone from this group.
    await expectSelectionModeEnded(page);
    await expect(page.getByRole('listitem', { name: 'Go One' })).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: 'Keep One' })).toBeVisible();
    // Moving saved windows closes no browser tab.
    expect(await tabCount(sw)).toBe(tabsBefore);
  });

  test('a click on empty space closes the open menu and keeps the selection; the next one leaves selection mode', async ({
    context,
    extensionId,
  }) => {
    const page = await openMoveSourceWithTick(context, extensionId);
    // Empty panel space: just above the left end of the selection bar, clear of the menu
    // (which opens above the trigger, at the right).
    const bar = (await selectionBar(page).boundingBox())!;
    const emptySpace = { x: bar.x + 40, y: bar.y - 24 };

    await page.getByRole('button', { name: 'Move to group' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy Target', exact: true })).toBeVisible();

    await page.mouse.click(emptySpace.x, emptySpace.y);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(ticked(page)).toHaveCount(1);
    await expect(selectionBar(page)).toHaveCount(1);

    await page.mouse.click(emptySpace.x, emptySpace.y);
    await expectSelectionModeEnded(page);
    // Nothing was moved.
    const source = await storedWindows(page, 'movesource1');
    expect(source.map((w) => w.tabs.map((t) => t.title))).toEqual([['Keep One'], ['Go One', 'Go Two']]);
  });
});

test.describe('Replace / Merge with current store detached copies', () => {
  for (const [label, menuName] of [
    ['Replace with current', /Replace with current/],
    ['Merge with current', /Merge with current/],
  ] as const) {
    test(`${label}: the group holds detached copies and removing a saved window closes no browser tab`, async ({
      context,
      extensionId,
    }) => {
      const server = await startTitleServer();
      try {
        const { page, sw } = await openWithWindows(
          context,
          extensionId,
          server,
          [SAVED],
          [
            ['Live F1', 'Live F2'],
            ['Live G1', 'Live G2'],
          ],
          ['Live F1']
        );
        const liveBefore = ['Live F1', 'Live F2', 'Live G1', 'Live G2'];
        expect(await liveTitles(sw)).toEqual(liveBefore);

        await page.getByRole('button', { name: 'Saved Set', exact: true }).click();
        await expect(page.getByRole('listitem', { name: 'Old One' })).toBeVisible();
        await page.getByRole('button', { name: 'More group options' }).click();
        await page.getByRole('menuitem', { name: menuName }).click();

        await waitForStoredGroups(
          page,
          (groups) => !!groups.find((g) => g.id === 'savedset001')?.windows.some((w) => w.tabs.some((t) => t.title === 'Live F1')),
          'Saved Set holding the live windows'
        );
        const stored = await storedWindows(page, 'savedset001');
        const liveCopies = stored.filter((w) => w.tabs.some((t) => t.title.startsWith('Live ')));
        expect(liveCopies.flatMap((w) => w.tabs.map((t) => t.title)).sort()).toEqual(liveBefore);
        expectDetached(liveCopies);
        const hasOld = stored.some((w) => w.tabs.some((t) => t.title === 'Old One'));
        expect(hasOld).toBe(label === 'Merge with current');
        await page.waitForTimeout(500);
        expect(await liveTitles(sw)).toEqual(liveBefore);
        const tabsBefore = await tabCount(sw);

        // Remove a saved window that came from the live session: no browser tab closes.
        await expect(page.getByRole('listitem', { name: 'Live F1' })).toBeVisible();
        await card(page, 'Live F1').locator('[data-window-header]').click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Remove window' }).click();
        await waitForStoredGroups(
          page,
          (groups) => !groups.find((g) => g.id === 'savedset001')?.windows.some((w) => w.tabs.some((t) => t.title === 'Live F1')),
          'Saved Set without the Live F window'
        );
        await page.waitForTimeout(500);
        expect(await liveTitles(sw)).toEqual(liveBefore);
        expect(await tabCount(sw)).toBe(tabsBefore);
      } finally {
        await server.close();
      }
    });
  }
});

test.describe('Deduplicate tabs on a saved group matches by position', () => {
  const DUPES = {
    id: 'dupesgroup01',
    name: 'Dupes',
    color: 'rgba(245,158,11,1)',
    windows: [
      {
        id: 0,
        incognito: false,
        focused: false,
        tabs: [
          { id: 0, title: 'Alpha', url: 'https://alpha.example.com' },
          { id: 0, title: 'Dup One', url: 'https://dup.example.com' },
        ],
      },
      {
        id: 0,
        incognito: false,
        focused: false,
        tabs: [
          { id: 0, title: 'Beta', url: 'https://beta.example.com' },
          { id: 0, title: 'Dup Two', url: 'https://dup.example.com' },
        ],
      },
    ],
  };

  const entryPoints = [
    [
      'windows panel menu',
      async (page: Page) => {
        await page.getByRole('button', { name: 'More group options' }).click();
      },
    ],
    [
      'sidebar context menu',
      async (page: Page) => {
        await page.getByRole('button', { name: 'Dupes', exact: true }).click({ button: 'right' });
      },
    ],
  ] as const;

  for (const [label, openMenu] of entryPoints) {
    test(`${label}: removes only the second copy of the duplicate URL; every other tab and both windows stay`, async ({
      context,
      extensionId,
    }) => {
      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, DUPES] as Parameters<typeof seedAndReload>[1]);
      const [sw] = context.serviceWorkers();
      await page.getByRole('button', { name: 'Dupes', exact: true }).click();
      await expect(page.getByRole('listitem', { name: 'Dup Two' })).toBeVisible();
      const tabsBefore = await tabCount(sw);

      await openMenu(page);
      await page.getByRole('menuitem', { name: /deduplicate tabs/i }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Remove duplicates' })).toBeVisible();
      await expect(dialog.getByText('1 duplicate tab will be removed.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Remove 1 duplicate' }).click();

      await waitForStoredGroups(
        page,
        (groups) => groups.find((g) => g.id === 'dupesgroup01')?.windows.flatMap((w) => w.tabs).length === 3,
        'Dupes holding 3 tabs'
      );
      const windows = await storedWindows(page, 'dupesgroup01');
      expect(windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['Alpha', 'Dup One'], ['Beta']]);
      await expect(page.getByRole('listitem', { name: 'Dup Two' })).toHaveCount(0);
      await expect(page.getByRole('listitem', { name: 'Dup One' })).toBeVisible();
      expect(await tabCount(sw)).toBe(tabsBefore);
    });
  }
});
