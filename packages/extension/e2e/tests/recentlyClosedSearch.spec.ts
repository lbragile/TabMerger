import type { Page, Worker } from '@playwright/test';
import { RECENTLY_CLOSED_META_ID, SEARCH_COPY } from '@tabmerger/shared';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, startTitleServer } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * Ctrl/Cmd+K finds recently closed tabs: a "Recently closed" section under the saved results, and
 * the `closed:` scope that lists only closed tabs. Enter reopens the picked entry.
 *
 * Pages come from a loopback server whose title is the last URL segment; a "user" close is
 * `chrome.tabs.remove` from the service worker (what the worker sees when the user closes a tab).
 */

type Server = Awaited<ReturnType<typeof startTitleServer>>;

/** Live (not cleared) entries of the recently-closed store, read from the service worker. */
async function closedTitles(sw: Worker): Promise<string[]> {
  return sw.evaluate(
    (metaId: string) =>
      new Promise<string[]>((resolve, reject) => {
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
            const rows = get.result as { id: string; clearedAt?: number; tabs: { url: string }[] }[];
            resolve(
              rows
                .filter((e) => e.id !== metaId && e.clearedAt === undefined)
                .flatMap((e) => e.tabs.map((t) => decodeURIComponent(t.url.split('/').pop() ?? '')))
            );
          };
          get.onerror = () => reject(get.error);
        };
      }),
    RECENTLY_CLOSED_META_ID
  );
}

/** Opens one background window with a tab per title, waits for the pages, then closes `close`. */
async function openThenClose(sw: Worker, server: Server, titles: string[], close: string[]): Promise<void> {
  await sw.evaluate(
    async ({ names, base }: { names: string[]; base: string }) => {
      await chrome.windows.create({ url: names.map((n) => `${base}/${encodeURIComponent(n)}`), focused: false });
    },
    { names: titles, base: server.base }
  );
  await expect
    .poll(async () => sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => t.status === 'complete' && /127\.0\.0\.1|localhost/.test(t.url ?? '')).length), {
      timeout: 15_000
    })
    .toBe(titles.length);
  // let the worker's snapshot cache see every tab (and its title)
  await sw.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  for (const name of close) {
    await sw.evaluate(async (title: string) => {
      const tab = (await chrome.tabs.query({})).find((t) => decodeURIComponent((t.url ?? '').split('/').pop() ?? '') === title);
      if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
    }, name);
  }
  await expect.poll(async () => (await closedTitles(sw)).sort(), { timeout: 10_000 }).toEqual([...close].sort());
}

/** Opens the search overlay and waits until its box has the focus, so typed keys reach it. */
async function openSearch(page: Page) {
  await page.getByRole('button', { name: 'Open search' }).click();
  await expect(page.getByRole('combobox', { name: SEARCH_COPY.searchInput })).toBeFocused();
}

const closedSection = (page: Page) => page.getByRole('group', { name: 'Recently closed' });

test.describe('Search: recently closed tabs', () => {
  test('a closed tab shows under "Recently closed"; Enter reopens it with an Undo toast', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
      const [sw] = context.serviceWorkers();
      await openThenClose(sw, server, ['Quarterly Invoices', 'Keep Open'], ['Quarterly Invoices']);

      await openSearch(page);
      await page.keyboard.type('invoices');
      const row = closedSection(page).getByRole('option');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('Quarterly Invoices');
      await expect(row).toContainText('closed today');

      await page.keyboard.press('ArrowDown');
      await expect(row).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Enter');

      // the overlay closes, the tab is open again and leaves the list
      await expect(page.getByRole('combobox', { name: SEARCH_COPY.searchInput })).toHaveCount(0);
      await expect
        .poll(async () => sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => (t.url ?? '').endsWith('/Quarterly%20Invoices')).length), {
          timeout: 10_000
        })
        .toBe(1);
      await expect.poll(async () => closedTitles(sw), { timeout: 10_000 }).toEqual([]);
      // the toast (with Undo) is the one announcement
      await expect(page.locator('[data-sonner-toast]').getByText('Reopened Quarterly Invoices')).toBeVisible();
    } finally {
      await server.close();
    }
  });

  test('closed: lists only closed tabs, and its words narrow them', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
      const [sw] = context.serviceWorkers();
      await openThenClose(sw, server, ['Stripe Billing', 'Mail Inbox', 'Keep Open'], ['Stripe Billing', 'Mail Inbox']);

      await openSearch(page);
      await page.keyboard.type('closed:');
      const listbox = page.getByRole('listbox', { name: 'Search results' });
      await expect(listbox.getByRole('option')).toHaveCount(2);
      await expect(closedSection(page).getByRole('option')).toHaveCount(2);

      await page.keyboard.type(' stripe');
      await expect(listbox.getByRole('option')).toHaveCount(1);
      await expect(listbox.getByRole('option')).toContainText('Stripe Billing');

      await page.keyboard.press('Control+A');
      await page.keyboard.type('closed: nothing like this');
      await expect(page.getByText('No matches for "closed: nothing like this"')).toBeVisible();
    } finally {
      await server.close();
    }
  });
});
