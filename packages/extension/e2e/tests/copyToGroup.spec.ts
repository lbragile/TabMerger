import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, readStoredGroups, startTitleServer, waitForStoredGroups } from '../helpers';

/**
 * "Copy to group" on a window in Now Open. The real window is NOT moved: its card stays in
 * Now Open in the same position with the same tabs, the Now Open counts do not change, and the
 * target group gains one saved window with those tabs.
 *
 * Needs REAL browser windows (Now Open is rebuilt from the live browser, a seeded Now Open is
 * overwritten), so the test opens two windows on a loopback server whose page title is the last
 * path segment (a stable, distinct row name per tab, no internet).
 */

const NOW_OPEN_PLACEHOLDER = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const TARGET = {
  id: 'copytarget1',
  name: 'Copy Target',
  color: 'rgba(59,130,246,1)',
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Existing', url: 'https://existing.example.com' }] }],
};

/** Per Now Open window card (page order), the titles of its fixture tabs. */
async function nowOpenLayout(page: Page): Promise<string[][]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('div[data-window-index]'))
      .filter((card) => card.querySelector('[data-window-header]'))
      .map((card) =>
        Array.from(card.querySelectorAll('[role="listitem"]'))
          .map((li) => li.getAttribute('aria-label') ?? '')
          .filter((t) => t.startsWith('Live '))
      )
      .filter((titles) => titles.length > 0)
  );
}

/** The "windows ◆ tabs" badge text of a sidebar row, e.g. "3◆7". */
async function sidebarBadge(page: Page, index: number): Promise<string> {
  const badge = page.locator(`[data-sidebar-group-index="${index}"] span:has(> span.opacity-40)`);
  return ((await badge.innerText()) || '').replace(/\s+/g, '');
}

test.describe('Now Open window — Copy to group', () => {
  test('copies the window into a saved group and leaves the real window card in Now Open untouched', async ({ context, extensionId }) => {
    const server = await startTitleServer();
    try {
      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, TARGET]);

      const [sw] = context.serviceWorkers();
      const urls = (names: string[]) => names.map((n) => `${server.base}/${encodeURIComponent(n)}`);
      await sw.evaluate(async (windows: string[][]) => {
        for (const url of windows) await chrome.windows.create({ url, focused: false });
      }, [urls(['Live A1', 'Live A2']), urls(['Live B1', 'Live B2', 'Live B3'])]);

      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Now Open', exact: true }).click();
      await expect(page.getByRole('listitem', { name: 'Live B3' })).toBeVisible({ timeout: 10_000 });

      const layoutBefore = await nowOpenLayout(page);
      expect(layoutBefore).toHaveLength(2);
      const aIndex = layoutBefore.findIndex((w) => w.includes('Live A1'));
      expect(aIndex).toBeGreaterThanOrEqual(0);
      const liveTabsBefore = layoutBefore[aIndex];
      expect(liveTabsBefore).toEqual(['Live A1', 'Live A2']);
      const nowOpenBadgeBefore = await sidebarBadge(page, 0);
      const targetBadgeBefore = await sidebarBadge(page, 1);
      expect(targetBadgeBefore).toBe('1◆1');

      // Open the first window's menu and copy it into "Copy Target".
      const card = page.locator('div[data-window-index]', { has: page.getByRole('listitem', { name: 'Live A1' }) })
        .filter({ has: page.locator('[data-window-header]') });
      await card.locator('[data-window-header]').click({ button: 'right' });
      const trigger = page.getByRole('menuitem', { name: 'Copy to group' });
      await expect(trigger).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Move to group' })).toHaveCount(0);
      await trigger.hover();
      await page.getByRole('menuitem', { name: 'Copy Target', exact: true }).click();

      // The target group gained exactly one window with the same tabs (read from IndexedDB).
      await waitForStoredGroups(
        page,
        (groups) => groups.find((g) => g.id === 'copytarget1')?.windows.length === 2,
        'Copy Target holding 2 windows'
      );
      const stored = (await readStoredGroups(page)).find((g) => g.id === 'copytarget1')!;
      expect(stored.windows.map((w) => w.tabs.map((t) => t.title))).toEqual([['Existing'], ['Live A1', 'Live A2']]);
      expect(await sidebarBadge(page, 1)).toBe('2◆3');

      // Now Open: same cards, same order, same tabs; counts unchanged; nothing was closed.
      await expect(page.getByRole('listitem', { name: 'Live A1' })).toBeVisible();
      expect(await nowOpenLayout(page)).toEqual(layoutBefore);
      expect(await sidebarBadge(page, 0)).toBe(nowOpenBadgeBefore);
      await page.waitForTimeout(500); // a late "Now Open changed" re-render would show up here
      expect(await nowOpenLayout(page)).toEqual(layoutBefore);
      expect(await sidebarBadge(page, 0)).toBe(nowOpenBadgeBefore);
      const liveUrls = await sw.evaluate(async () =>
        (await chrome.tabs.query({})).map((t) => t.url ?? '').filter((u) => u.includes('Live%20'))
      );
      expect(liveUrls).toHaveLength(5);

      // The saved copy shows in the target group's panel.
      await page.getByRole('button', { name: 'Copy Target', exact: true }).click();
      await expect(page.getByRole('listitem', { name: 'Live A1' })).toBeVisible();
      await expect(page.getByRole('listitem', { name: 'Live A2' })).toBeVisible();
      await expect(page.getByRole('listitem', { name: 'Existing' })).toBeVisible();
    } finally {
      await server.close();
    }
  });
});
