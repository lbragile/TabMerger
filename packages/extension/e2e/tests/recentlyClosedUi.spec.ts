import type { BrowserContext, Page, Worker } from '@playwright/test';
import { AUTO_ITEM_COLORS, RECENTLY_CLOSED_META_ID } from '@tabmerger/shared';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, startTitleServer, waitForStoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * The Recently closed UI: the sidebar section (one row per day), the day view in the main panel,
 * reopen / restore / remove with Undo, and the session colour picked in the Save session dialog.
 * Real tabs and windows are opened and closed from the service worker on a loopback server whose
 * page title is the last URL segment (a close made there is what the worker sees for a user close).
 */

type Server = Awaited<ReturnType<typeof startTitleServer>>;

const lastSegment = (url: string) => decodeURIComponent(url.split('/').pop() ?? '');

/** The non-cleared stored entries' tab titles, newest first. */
async function storedTitles(sw: Worker): Promise<string[][]> {
  const all = await sw.evaluate(
    () =>
      new Promise<{ id: string; closedAt: number; clearedAt?: number; tabs: { url: string }[] }[]>((resolve, reject) => {
        const req = indexedDB.open('tabmerger');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('recentlyClosed', 'readonly').objectStore('recentlyClosed').getAll();
          get.onsuccess = () => {
            db.close();
            resolve(get.result);
          };
          get.onerror = () => reject(get.error);
        };
      })
  );
  return all
    .filter((e) => e.id !== RECENTLY_CLOSED_META_ID && e.clearedAt === undefined)
    .sort((a, b) => b.closedAt - a.closedAt)
    .map((e) => e.tabs.map((t) => lastSegment(t.url)));
}

/** Titles of the open loopback tabs. */
async function openTitles(sw: Worker): Promise<string[]> {
  return sw.evaluate(async () =>
    (await chrome.tabs.query({})).filter((t) => /127\.0\.0\.1|localhost/.test(t.url ?? '')).map((t) => decodeURIComponent((t.url ?? '').split('/').pop() ?? ''))
  );
}

async function openWindow(sw: Worker, server: Server, names: string[]): Promise<number> {
  const id = await sw.evaluate(
    async ({ names, base }: { names: string[]; base: string }) => (await chrome.windows.create({ url: names.map((n) => `${base}/${encodeURIComponent(n)}`), focused: false }))!.id!,
    { names, base: server.base }
  );
  await expect
    .poll(async () => sw.evaluate(async (wid: number) => (await chrome.tabs.query({ windowId: wid })).filter((t) => t.status === 'complete').length, id), { timeout: 15_000 })
    .toBe(names.length);
  // let the worker's snapshot cache see every tab
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  return id;
}

async function closeTab(sw: Worker, title: string): Promise<void> {
  await sw.evaluate(async (name: string) => {
    const tab = (await chrome.tabs.query({})).find((t) => decodeURIComponent((t.url ?? '').split('/').pop() ?? '') === name);
    if (tab?.id) await chrome.tabs.remove(tab.id);
  }, title);
}

async function setup(context: BrowserContext, extensionId: string): Promise<{ page: Page; sw: Worker }> {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  const [sw] = context.serviceWorkers();
  return { page, sw };
}

const sectionToggle = (page: Page) => page.getByRole('button', { name: /^recently closed \(/i });
const todayRow = (page: Page) => page.getByRole('button', { name: 'Show tabs closed today' });
const dayView = (page: Page) => page.getByTestId('closed-day-view');
/** The Undo button of the toast that says `text`. */
const toastUndo = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text }).getByRole('button', { name: 'Undo' });

test.describe('Recently closed: sidebar section and day view', () => {
  test('starts open and empty, then shows Today after a close; the day opens on the right as the current row', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId);
      await expect(sectionToggle(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(sectionToggle(page)).toHaveAccessibleName(/recently closed \(0\)/i);
      await expect(page.getByText(/^Nothing closed yet\./)).toBeVisible();

      await openWindow(sw, server, ['Keep A', 'Closed B']);
      await closeTab(sw, 'Closed B');
      await expect(todayRow(page)).toBeVisible({ timeout: 10_000 });
      await expect(sectionToggle(page)).toHaveAccessibleName(/recently closed \(1\)/i);
      await expect(todayRow(page)).toHaveAccessibleDescription('1 tab');

      await todayRow(page).click();
      await expect(dayView(page)).toBeVisible();
      await expect(dayView(page).getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
      await expect(todayRow(page)).toHaveAttribute('aria-current', 'page');
      await expect(dayView(page).getByRole('button', { name: /^Reopen Closed B, closed / })).toBeVisible();

      // ✕ goes back and returns focus to the day row
      await dayView(page).getByRole('button', { name: 'Close this view' }).click();
      await expect(dayView(page)).toHaveCount(0);
      await expect(todayRow(page)).toBeFocused();
    } finally {
      await server.close();
    }
  });

  test('reopening a tab takes it off the list and opens it; Undo closes it and brings it back', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId);
      await openWindow(sw, server, ['Keep A', 'Reopen me', 'Other']);
      await closeTab(sw, 'Other');
      await closeTab(sw, 'Reopen me');
      await expect.poll(() => storedTitles(sw), { timeout: 10_000 }).toEqual([['Reopen me'], ['Other']]);

      await todayRow(page).click();
      // Ctrl click: in the background, the popup page keeps the focus
      await dayView(page).getByRole('button', { name: /^Reopen Reopen me, closed / }).click({ modifiers: ['Control'] });
      await expect.poll(() => openTitles(sw)).toContain('Reopen me');
      await expect.poll(() => storedTitles(sw)).toEqual([['Other']]);
      await toastUndo(page, 'Reopened Reopen me').click();
      await expect.poll(() => storedTitles(sw)).toEqual([['Reopen me'], ['Other']]);
      await expect.poll(() => openTitles(sw)).not.toContain('Reopen me');
    } finally {
      await server.close();
    }
  });

  test('a closed window restores as a window; its chevron lists the tabs', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId);
      const winId = await openWindow(sw, server, ['Win One', 'Win Two', 'Win Three']);
      await sw.evaluate((id: number) => chrome.windows.remove(id), winId);
      await expect.poll(() => storedTitles(sw), { timeout: 10_000 }).toEqual([['Win One', 'Win Two', 'Win Three']]);

      await todayRow(page).click();
      const restore = dayView(page).getByRole('button', { name: /^Restore window with 3 tabs, closed / });
      await expect(restore).toBeVisible();
      await dayView(page).getByRole('button', { name: /^Tabs of the window closed at .*, 3 tabs$/ }).click();
      await expect(dayView(page).getByRole('list', { name: /^Tabs of the window closed at .*, 3 tabs$/ }).getByRole('button')).toHaveCount(3);

      await restore.click({ modifiers: ['Control'] });
      await expect.poll(() => openTitles(sw)).toEqual(expect.arrayContaining(['Win One', 'Win Two', 'Win Three']));
      // the only entry of the day is gone, so the view falls back to the group shown before
      await expect.poll(() => storedTitles(sw)).toEqual([]);
      await expect(dayView(page)).toHaveCount(0);
    } finally {
      await server.close();
    }
  });

  test('Remove from list (row menu) and the sidebar Remove-day button, each with Undo', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId);
      await openWindow(sw, server, ['Keep A', 'Gone 1', 'Gone 2']);
      await closeTab(sw, 'Gone 2');
      await closeTab(sw, 'Gone 1');
      await expect.poll(() => storedTitles(sw), { timeout: 10_000 }).toEqual([['Gone 1'], ['Gone 2']]);

      await todayRow(page).click();
      await dayView(page).getByRole('button', { name: 'More options for Gone 1' }).click();
      await page.getByRole('menuitem', { name: 'Remove from list' }).click();
      await expect.poll(() => storedTitles(sw)).toEqual([['Gone 2']]);
      await toastUndo(page, 'Removed Gone 1 from the list').click();
      await expect.poll(() => storedTitles(sw)).toEqual([['Gone 1'], ['Gone 2']]);

      await page.getByRole('button', { name: "Remove today's closed tabs from the list" }).click();
      await expect.poll(() => storedTitles(sw)).toEqual([]);
      await expect(page.getByText(/^Nothing closed yet\./)).toBeVisible();
      await toastUndo(page, 'Cleared 2 closed tabs and windows').click();
      await expect.poll(() => storedTitles(sw)).toEqual([['Gone 1'], ['Gone 2']]);
      await expect(todayRow(page)).toBeVisible();
    } finally {
      await server.close();
    }
  });

  test('Save to group… puts the tab into a saved group and keeps it in the list', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId);
      await openWindow(sw, server, ['Keep A', 'Save me']);
      await closeTab(sw, 'Save me');
      await expect.poll(() => storedTitles(sw), { timeout: 10_000 }).toEqual([['Save me']]);

      await todayRow(page).click();
      await dayView(page).getByRole('button', { name: 'More options for Save me' }).click();
      // the keyboard: a pointer moving to the submenu crosses the other items, which closes it
      await page.getByRole('menuitem', { name: 'Save to group…' }).press('ArrowRight');
      await expect(page.getByRole('menuitem', { name: WORK_GROUP.name })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-sonner-toast]')).toContainText(`Saved to ${WORK_GROUP.name}`);
      await waitForStoredGroup(
        page,
        (g) => g.id === WORK_GROUP.id && g.windows.some((w) => w.tabs.some((t) => lastSegment(t.url) === 'Save me')),
        'the closed tab saved into Work'
      );
      expect(await storedTitles(sw)).toEqual([['Save me']]);
    } finally {
      await server.close();
    }
  });
});

/** Stored sessions' colours, by name. */
async function sessionColors(page: Page): Promise<Record<string, string | undefined>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, string | undefined>>((resolve, reject) => {
        const req = indexedDB.open('tabmerger');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const get = req.result.transaction('sessions', 'readonly').objectStore('sessions').getAll();
          get.onsuccess = () => {
            req.result.close();
            resolve(Object.fromEntries((get.result as { name: string; color?: string }[]).map((s) => [s.name, s.color])));
          };
        };
      })
  );
}

async function saveSession(page: Page, name: string, color?: string): Promise<void> {
  await page.getByRole('button', { name: 'Save current session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Session name').fill(name);
  if (color) await dialog.getByRole('radio', { name: color }).check({ force: true });
  else await expect(dialog.getByRole('radio', { name: 'Random' })).toBeChecked();
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toHaveCount(0);
}

test.describe('Session colours', () => {
  test('Random gives a palette colour that differs from the last session; a picked colour is saved and shown', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId);
    await saveSession(page, 'First', 'Teal');
    await expect.poll(async () => (await sessionColors(page)).First).toBe(AUTO_ITEM_COLORS[9]);
    await saveSession(page, 'Second');
    await expect.poll(async () => (await sessionColors(page)).Second).toBeTruthy();
    const second = (await sessionColors(page)).Second!;
    expect(AUTO_ITEM_COLORS).toContain(second);
    expect(second).not.toBe(AUTO_ITEM_COLORS[9]);

    // the row's start bar and the view's dot show the colour
    await page.getByRole('button', { name: /^sessions \(/i }).click();
    const firstRow = page.getByTestId('sessions-list').getByRole('listitem').filter({ hasText: 'First' });
    await expect(firstRow).toHaveCSS('border-inline-start-color', 'rgb(20, 184, 166)');
    await firstRow.getByRole('button', { name: 'Show session First' }).click();
    await expect(page.getByTestId('session-view').getByRole('heading', { level: 2, name: 'First' })).toBeVisible();
  });
});
