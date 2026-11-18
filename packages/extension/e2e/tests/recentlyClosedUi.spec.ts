import AxeBuilder from '@axe-core/playwright';
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

const sectionToggle = (page: Page) => page.getByRole('button', { name: /^recently closed \(/i });

/** Opens the popup on seeded groups; `expand` (default) opens the Recently closed section, which starts collapsed. */
async function setup(context: BrowserContext, extensionId: string, { expand = true }: { expand?: boolean } = {}): Promise<{ page: Page; sw: Worker }> {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  const [sw] = context.serviceWorkers();
  if (expand) {
    await sectionToggle(page).click();
    await expect(sectionToggle(page)).toHaveAttribute('aria-expanded', 'true');
  }
  return { page, sw };
}
const todayRow = (page: Page) => page.getByRole('button', { name: 'Show tabs closed today' });
const dayView = (page: Page) => page.getByTestId('closed-day-view');
/** The Undo button of the toast that says `text`. */
const toastUndo = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text }).getByRole('button', { name: 'Undo' });

test.describe('Recently closed: sidebar section and day view', () => {
  test('starts collapsed; expanded (bold header) and empty, then shows Today after a close; the day opens on the right as the current row', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const { page, sw } = await setup(context, extensionId, { expand: false });
      await expect(sectionToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(sectionToggle(page).locator('span.uppercase')).toHaveCSS('font-weight', '400');
      await sectionToggle(page).click();
      await expect(sectionToggle(page)).toHaveAttribute('aria-expanded', 'true');
      // bold (700), not semibold: 600 in the platform UI font at 11px barely differed from 400
      await expect(sectionToggle(page).locator('span.uppercase')).toHaveCSS('font-weight', '700');
      await expect(sectionToggle(page)).toHaveAccessibleName(/recently closed \(0\)/i);
      // signed out = Free: its rolling window
      await expect(page.getByText('Nothing closed yet. Tabs you close show up here by day, for your last 2 days.')).toBeVisible();

      await openWindow(sw, server, ['Keep A', 'Closed B']);
      await closeTab(sw, 'Closed B');
      await expect(todayRow(page)).toBeVisible({ timeout: 10_000 });
      await expect(sectionToggle(page)).toHaveAccessibleName(/recently closed \(1\)/i);
      await expect(todayRow(page)).toHaveAccessibleDescription('1 tab');

      await todayRow(page).click();
      await expect(dayView(page)).toBeVisible();
      await expect(dayView(page).getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();
      await expect(todayRow(page)).toHaveAttribute('aria-current', 'page');
      await expect(todayRow(page).locator('span').first()).toHaveCSS('font-weight', '700');
      await expect(dayView(page).getByRole('button', { name: /^Reopen Closed B, closed / })).toBeVisible();

      // ✕ goes back and returns focus to the day row
      await dayView(page).getByRole('button', { name: 'Close this view' }).click();
      await expect(dayView(page)).toHaveCount(0);
      await expect(todayRow(page)).toBeFocused();
    } finally {
      await server.close();
    }
  });

  test('Free with 3 stored days lists its 2 newest, "(2)" in the header, and storage is trimmed to match; the open day is bold', async ({ context, extensionId }) => {
    const { page, sw } = await setup(context, extensionId, { expand: false });
    // kept under the Pro limits (or an older rule): no close today, then yesterday, 2 and 5 days ago
    await page.evaluate(async () => {
      const at = (back: number) => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime();
      };
      const rows = [1, 1, 2, 5].map((back, i) => ({ id: `seeded-${i}`, closedAt: at(back) - i * 60_000, kind: 'tab', tabs: [{ url: `https://seeded${i}.example/`, title: `Seeded ${i}` }] }));
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('tabmerger');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('recentlyClosed', 'readwrite');
          for (const row of rows) tx.objectStore('recentlyClosed').put(row);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await page.reload({ waitUntil: 'networkidle' });
    // signed out on a fresh profile = Free, confirmed: the header counts only the rows shown
    await expect(sectionToggle(page)).toHaveAccessibleName(/recently closed \(2\)/i);
    await sectionToggle(page).click();
    const dayRows = page.locator('[data-closed-day-open]');
    await expect(dayRows).toHaveCount(2);
    const yesterday = page.getByRole('button', { name: 'Show tabs closed yesterday' });
    await expect(yesterday).toHaveAccessibleDescription('2 tabs');
    await expect(page.getByTestId('recently-closed-free-note')).toContainText('Free keeps your last 2 days.');
    // the popup's catch-up prune: storage holds exactly the 2 days shown
    await expect.poll(async () => (await storedTitles(sw)).length, { timeout: 10_000 }).toBe(3);

    await yesterday.click();
    await expect(yesterday).toHaveAttribute('aria-current', 'page');
    await expect(yesterday.locator('span').first()).toHaveCSS('font-weight', '700');
    await expect(sectionToggle(page).locator('span.uppercase')).toHaveCSS('font-weight', '700');
    const other = page.locator('[data-closed-day-open]:not([aria-current])');
    await expect(other.locator('span').first()).toHaveCSS('font-weight', '400');
    // the other day is current once opened
    await other.click();
    await expect(yesterday).not.toHaveAttribute('aria-current');
    await expect(yesterday.locator('span').first()).toHaveCSS('font-weight', '400');
    await expect(page.locator('[data-closed-day-open][aria-current="page"] span').first()).toHaveCSS('font-weight', '700');
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

/**
 * Stores today's entries closed in three local hours (newest first: 16:42, 16:05 window, 11:30,
 * 11:02, 09:15) and reloads. Today's date whatever the clock says: a time later today is still today.
 */
async function seedTodayAcrossHours(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const d = new Date();
    const at = (h: number, m: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    const tab = (id: string, closedAt: number) => ({ id, closedAt, kind: 'tab', tabs: [{ url: `https://${id}.example/`, title: `Hour ${id}` }] });
    const rows = [
      tab('h16a', at(16, 42)),
      { id: 'h16w', closedAt: at(16, 5), kind: 'window', tabs: [{ url: 'https://w1.example/', title: 'W1' }, { url: 'https://w2.example/', title: 'W2' }] },
      tab('h11a', at(11, 30)),
      tab('h11b', at(11, 2)),
      tab('h09a', at(9, 15))
    ];
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('recentlyClosed', 'readwrite');
        for (const row of rows) tx.objectStore('recentlyClosed').put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
}

test.describe('Recently closed: day at a glance (hours)', () => {
  test('hour markers sit below their entries; a bar shows only its hour; Show all hours; the strip passes axe', async ({ context, extensionId }) => {
    const { page } = await setup(context, extensionId, { expand: false });
    await seedTodayAcrossHours(page);
    await sectionToggle(page).click();
    await todayRow(page).click();
    const view = dayView(page);
    const strip = view.getByRole('group', { name: 'Tabs closed per hour' });
    await expect(strip.getByRole('button')).toHaveCount(3);
    const bar = (hour: number) => strip.locator(`[data-closed-hour-bar="${hour}"]`);
    await expect(bar(16)).toHaveAccessibleName(/, 2 closed$/);
    await expect(bar(9)).toHaveAccessibleName(/, 1 closed$/);
    await expect(view.getByTestId('closed-hour-status')).toHaveText(/^Busiest: .+ and .+$/);

    // DOM order: each hour's entries, then its marker
    const list = view.getByRole('list', { name: 'Closed tabs and windows' });
    const order = await list.evaluate((ul) =>
      [...ul.children].map((li) => li.getAttribute('data-closed-hour-marker') ?? li.querySelector('[data-closed-entry]')?.getAttribute('data-closed-entry'))
    );
    expect(order).toEqual(['h16a', 'h16w', '16', 'h11a', 'h11b', '11', 'h09a', '9']);
    await expect(list.locator('[data-closed-hour-marker]').first()).toHaveAttribute('aria-hidden', 'true');

    // arrow keys cross from 16:00 into 11:00
    await list.getByRole('button', { name: /^Restore window with 2 tabs/ }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(list.getByRole('button', { name: /^Reopen Hour h11a/ })).toBeFocused();

    const axe = await new AxeBuilder({ page }).include('[data-testid="closed-hour-strip"]').analyze();
    expect(axe.violations).toEqual([]);

    await bar(11).click();
    await expect(bar(11)).toHaveAttribute('aria-pressed', 'true');
    await expect(bar(16)).toHaveAttribute('aria-pressed', 'false');
    await expect(list.locator('[data-closed-entry]')).toHaveCount(2);
    await expect(list.getByRole('button', { name: /^Reopen Hour h11a/ })).toBeVisible();
    await expect(view.getByTestId('closed-hour-status')).toContainText(/^Showing .+ · 2 closed/);
    await expect(page.getByTestId('section-view-status')).toHaveText(/^Showing .+ · 2 closed$/);
    const pickedAxe = await new AxeBuilder({ page }).include('[data-testid="closed-hour-strip"]').analyze();
    expect(pickedAxe.violations).toEqual([]);

    await view.getByRole('button', { name: 'Show all hours' }).click();
    await expect(list.locator('[data-closed-entry]')).toHaveCount(5);
    await expect(bar(11)).toHaveAttribute('aria-pressed', 'false');
    await expect(bar(11)).toBeFocused();
    await expect(view.getByRole('button', { name: 'Show all hours' })).toHaveCount(0);

    // the bars are one tab stop, arrows move along them
    await page.keyboard.press('ArrowRight');
    await expect(bar(16)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(list.locator('[data-closed-entry]')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await expect(list.locator('[data-closed-entry]')).toHaveCount(5);
  });
});

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
