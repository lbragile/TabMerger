import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, readStoredGroups, seedAndReload, signInAsPro, startFixtureServer } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * Auto-save open tabs: the Settings → Data card (Free vs Pro defaults and copy) and the whole
 * "Auto-save now" round trip through the background worker (signed out = Free, confirmed without
 * any network request): a new group in the Auto-saved section, then "Keep" moves it to the main
 * group list. Schedule, threshold, rolling replacement and plan rules are covered by the unit and
 * integration suites.
 */

async function openDataTab(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: /^data$/i }).click();
}

const card = (page: Page) => page.getByRole('region', { name: 'Auto-save open tabs' });

test.describe('Auto-save open tabs - Settings → Data', () => {
  test('Free (signed out): first on the Data tab, off by default, newest-2 copy and an upgrade link', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    const box = card(page);
    await expect(box.getByRole('switch', { name: 'Auto-save open tabs' })).not.toBeChecked();
    await expect(box.getByText(/keeps the newest 2 auto-saves/)).toBeVisible();
    await expect(box.getByRole('button', { name: 'Upgrade to keep them all' })).toBeVisible();
    // first on the tab: above the automatic backups section
    const autoSaveTop = (await box.boundingBox())!.y;
    const backupsTop = (await page.getByRole('region', { name: 'Automatic backups' }).boundingBox())!.y;
    expect(autoSaveTop).toBeLessThan(backupsTop);

    // turning it on is remembered
    await box.getByRole('switch', { name: 'Auto-save open tabs' }).click();
    await expect(box.getByRole('switch', { name: 'Auto-save open tabs' })).toBeChecked();
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    await expect(card(page).getByRole('switch', { name: 'Auto-save open tabs' })).toBeChecked();
  });

  test('Pro: on by default with the "every auto-save is kept" copy; the schedule persists; no horizontal overflow', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    const box = card(page);
    await expect(box.getByRole('switch', { name: 'Auto-save open tabs' })).toBeChecked();
    await expect(box.getByText(/Every auto-save is kept/)).toBeVisible();
    await expect(box.getByRole('button', { name: 'Upgrade to keep them all' })).toHaveCount(0);

    await box.getByRole('combobox', { name: 'Auto-save schedule' }).click();
    await page.getByRole('option', { name: 'Every 2 hours' }).click();
    await expect(box.getByRole('combobox', { name: 'Auto-save schedule' })).toContainText('Every 2 hours');
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    await expect(card(page).getByRole('combobox', { name: 'Auto-save schedule' })).toContainText('Every 2 hours');

    const overflow = await card(page).evaluate((el) => {
      const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
      return { card: el.scrollWidth - el.clientWidth, scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
    });
    expect(overflow.card).toBeLessThanOrEqual(0);
    expect(overflow.scroller).toBeLessThanOrEqual(0);
  });
});

test.describe('Auto-save open tabs - the Auto-saved section', () => {
  test('"Auto-save now" saves the open tab into the Auto-saved section; Keep moves it to the group list', async ({ context, extensionId }) => {
    const server = await startFixtureServer('Auto-save fixture page');
    try {
      const site = await context.newPage();
      await site.goto(server.url, { waitUntil: 'load' });

      const page = await openPopup(context, extensionId);
      await seedAndReload(page, [NOW_OPEN]);

      const header = page.getByRole('button', { name: /^AUTO-SAVED \(0\)$/ });
      await expect(header).toBeVisible();
      await page.getByRole('button', { name: 'Auto-save now' }).first().click();

      // the worker wrote it; the popup refetches on the groups-changed broadcast
      const freeHeader = page.getByRole('button', { name: /^AUTO-SAVED \(1 of 2\)$/ });
      await expect(freeHeader).toBeVisible({ timeout: 15_000 });
      await expect(freeHeader).toHaveAttribute('aria-expanded', 'true');
      const open = page.getByRole('button', { name: /^Open Auto-saved / });
      await expect(open).toHaveCount(1);

      const stored = await readStoredGroups(page);
      const auto = stored.find((g) => g.name.startsWith('Auto-saved '))!;
      expect(auto.windows.flatMap((w) => w.tabs.map((t) => t.url))).toContain(`${server.url}/`);
      expect(auto.windows.flatMap((w) => w.tabs.map((t) => t.url)).some((u) => u.startsWith('chrome-extension://'))).toBe(false);

      // opening it shows the banner in the main panel
      await open.click();
      await expect(page.getByTestId('auto-save-banner')).toContainText('newest 2 auto-saves');

      // a second run finds nothing new: no second group
      await page.getByRole('button', { name: 'Auto-save now' }).first().click();
      await expect(page.getByText(/Nothing new to save/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Open Auto-saved / })).toHaveCount(1);

      // Keep: it leaves the section and joins the main group list
      await page.getByRole('button', { name: /^Keep Auto-saved .* as a group$/ }).click();
      await expect(page.getByText("Moved to your groups. It won't be removed automatically.")).toBeVisible();
      await expect(page.getByRole('button', { name: /^AUTO-SAVED \(0\)$/ })).toBeVisible();
      await expect(page.getByTestId('auto-save-banner')).toHaveCount(0);
      await expect(page.locator('[data-sidebar-group-index]').filter({ hasText: auto.name })).toHaveCount(1);
    } finally {
      await server.close();
    }
  });
});
