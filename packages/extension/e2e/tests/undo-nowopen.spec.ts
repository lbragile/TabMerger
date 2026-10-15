import type { Page, Worker } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, readStoredGroups, startTitleServer, waitForStoredGroups } from '../helpers';

/**
 * A drag OUT of Now Open moves: the saved group gets a copy and the real tabs close. It is ONE
 * undo step: Undo removes the copy and reopens the closed tabs, Redo closes exactly the tabs Undo
 * reopened again (by id). Real browser windows on a loopback title server (no internet); "open" and
 * "closed" are read from the service worker, never from the UI.
 */

const NOW_OPEN_PLACEHOLDER = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const TARGET = {
  id: 'undotarget1',
  name: 'Undo Target',
  color: 'rgba(59,130,246,1)',
  windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Existing', url: 'https://existing.example.com' }] }],
};

/** Every real tab named `Live ...` (the decoded last URL segment), sorted. */
async function liveTitles(sw: Worker): Promise<string[]> {
  return sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs
      .map((t) => decodeURIComponent((t.url || t.pendingUrl || '').split('/').pop() ?? ''))
      .filter((t) => t.startsWith('Live '))
      .sort();
  });
}

async function targetWindows(page: Page): Promise<string[][]> {
  const group = (await readStoredGroups(page)).find((g) => g.id === 'undotarget1')!;
  return group.windows.map((w) => w.tabs.map((t) => t.title));
}

const isEnabled = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).isEnabled();

test('a Now Open window dragged into a group is one undo step: Undo reopens its tabs, Redo closes them again', async ({ context, extensionId }) => {
  const server = await startTitleServer();
  try {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, TARGET]);
    const [sw] = context.serviceWorkers();
    const urls = ['Live A1', 'Live A2'].map((n) => `${server.base}/${encodeURIComponent(n)}`);
    await sw.evaluate(async (url: string[]) => {
      await chrome.windows.create({ url, focused: false });
    }, urls);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Now Open', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Live A2' })).toBeVisible({ timeout: 10_000 });
    expect(await isEnabled(page, 'Undo')).toBe(false);

    // Drag the live window's grip onto the target group's sidebar row
    const grip = page
      .locator('div[data-window-index]', { has: page.getByRole('listitem', { name: 'Live A1' }) })
      .filter({ has: page.locator('[data-window-header]') })
      .locator('[aria-label^="Drag to reorder window"]');
    await grip.hover();
    const from = (await grip.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 3 });
    const row = (await page.locator('[data-sidebar-group-index="1"]').boundingBox())!;
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 14 });
    await page.mouse.up();

    await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'undotarget1')?.windows.length === 2, 'the copy in the target');
    expect(await targetWindows(page)).toEqual([['Existing'], ['Live A1', 'Live A2']]);
    await expect.poll(() => liveTitles(sw), { timeout: 10_000 }).toEqual([]);

    // ONE step; Undo removes the copy and reopens both tabs
    await expect.poll(() => isEnabled(page, 'Undo')).toBe(true);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'undotarget1')?.windows.length === 1, 'the copy removed again');
    expect(await targetWindows(page)).toEqual([['Existing']]);
    await expect.poll(() => liveTitles(sw), { timeout: 10_000 }).toEqual(['Live A1', 'Live A2']);
    await expect.poll(() => isEnabled(page, 'Undo')).toBe(false);

    // Redo puts the copy back and closes exactly the reopened tabs
    await expect.poll(() => isEnabled(page, 'Redo')).toBe(true);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await waitForStoredGroups(page, (g) => g.find((x) => x.id === 'undotarget1')?.windows.length === 2, 'the copy back');
    expect(await targetWindows(page)).toEqual([['Existing'], ['Live A1', 'Live A2']]);
    await expect.poll(() => liveTitles(sw), { timeout: 10_000 }).toEqual([]);
    expect(page.isClosed()).toBe(false);
  } finally {
    await server.close();
  }
});
