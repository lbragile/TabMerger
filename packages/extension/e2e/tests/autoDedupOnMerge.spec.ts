import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, readStoredGroups, seedAndReload, startTitleServer, waitForStoredGroup } from '../helpers';

/**
 * Settings → General → "Auto-deduplicate on merge", end to end: off (the default) a merge keeps
 * every tab; switched on in Settings, "Unite windows" and "Merge with current" leave out tabs
 * whose address the result already has, keeping the group's own tab. Merge groups and AI
 * Organize merges use the same rule (unit + integration suites).
 */

const NOW_OPEN_PLACEHOLDER = { id: 'now-open', name: 'Now Open', permanent: true, windows: [] };
const tab = (title: string, url: string) => ({ id: 0, title, url });

/** A saved group of two windows that repeat one address. */
const REPEATS = {
  id: 'repeats0001',
  name: 'Repeats',
  color: 'rgba(59,130,246,1)',
  windows: [
    { id: 0, incognito: false, focused: false, tabs: [tab('Alpha', 'https://alpha.example.com/'), tab('Beta', 'https://beta.example.com/')] },
    { id: 0, incognito: false, focused: false, tabs: [tab('Alpha again', 'https://alpha.example.com/'), tab('Gamma', 'https://gamma.example.com/')] },
  ],
};

const storedTitles = async (page: Page, id: string) =>
  ((await readStoredGroups(page)).find((g) => g.id === id)?.windows ?? []).map((w) => w.tabs.map((t) => t.title));

async function openGroupMenuItem(page: Page, groupName: string, item: RegExp): Promise<void> {
  await page.getByRole('button', { name: groupName, exact: true }).click();
  await page.getByRole('button', { name: 'More group options' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Turns the setting on in Settings → General and waits for the save to reach IndexedDB. */
async function turnOnAutoDedup(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: /Settings/ });
  const toggle = settings.getByRole('switch', { name: 'Auto-deduplicate on merge' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  const save = settings.getByRole('button', { name: /save changes/i });
  await save.click();
  // Save turns disabled once the settings are written
  await expect(save).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
}

test.describe('Auto-deduplicate on merge', () => {
  test('off (the default): Unite windows keeps the repeated tab', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, REPEATS] as Parameters<typeof seedAndReload>[1]);

    await openGroupMenuItem(page, 'Repeats', /Unite windows/);
    await waitForStoredGroup(page, (g) => g.id === REPEATS.id && g.windows.length === 1, 'Repeats united into one window');
    expect(await storedTitles(page, REPEATS.id)).toEqual([['Alpha', 'Beta', 'Alpha again', 'Gamma']]);
  });

  test('on: Unite windows keeps one tab per address, and Undo brings the repeat back', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, REPEATS] as Parameters<typeof seedAndReload>[1]);
    await turnOnAutoDedup(page);

    await openGroupMenuItem(page, 'Repeats', /Unite windows/);
    await waitForStoredGroup(page, (g) => g.id === REPEATS.id && g.windows.length === 1, 'Repeats united into one window');
    expect(await storedTitles(page, REPEATS.id)).toEqual([['Alpha', 'Beta', 'Gamma']]);
    await expect(page.getByRole('listitem', { name: 'Alpha again' })).toHaveCount(0);

    // One undo step takes back the whole merge, the removed tab included
    await page.getByRole('button', { name: /undo/i }).click();
    await waitForStoredGroup(page, (g) => g.id === REPEATS.id && g.windows.length === 2, 'Repeats back to two windows');
    expect(await storedTitles(page, REPEATS.id)).toEqual([['Alpha', 'Beta'], ['Alpha again', 'Gamma']]);
  });

  test("on: Merge with current leaves out an open tab the group already has and keeps the group's own", async ({
    context,
    extensionId,
  }) => {
    const server = await startTitleServer();
    try {
      const url = (name: string) => `${server.base}/${encodeURIComponent(name)}`;
      const saved = {
        id: 'mergewith01',
        name: 'Merge Target',
        color: 'rgba(16,185,129,1)',
        windows: [{ id: 0, incognito: false, focused: false, tabs: [tab('Saved copy of Live A', url('Live A'))] }],
      };
      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [NOW_OPEN_PLACEHOLDER, saved] as Parameters<typeof seedAndReload>[1]);
      await turnOnAutoDedup(page);

      // Real windows, so Now Open holds them: Live A repeats the saved tab's address, Live B is new
      const [sw] = context.serviceWorkers();
      await sw.evaluate(async (urls: string[]) => {
        await chrome.windows.create({ url: urls, focused: false });
      }, [url('Live A'), url('Live B')]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Now Open', exact: true }).click();
      await expect(page.getByRole('listitem', { name: 'Live B' })).toBeVisible({ timeout: 10_000 });

      await openGroupMenuItem(page, 'Merge Target', /Merge with current/);
      await waitForStoredGroup(
        page,
        (g) => g.id === saved.id && g.windows.some((w) => w.tabs.some((t) => t.title === 'Live B')),
        'Merge Target holding the open windows'
      );
      const tabs = (await storedTitles(page, saved.id)).flat();
      expect(tabs).toContain('Saved copy of Live A');
      expect(tabs).toContain('Live B');
      expect(tabs).not.toContain('Live A');
      // The browser tab itself stays open: only the saved copy was left out
      const open = await sw.evaluate(async (u: string) => (await chrome.tabs.query({ url: u })).length, url('Live A'));
      expect(open).toBe(1);
    } finally {
      await server.close();
    }
  });
});
