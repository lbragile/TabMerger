import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, signInAsPro } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * Settings → Data layout: four titled sections in a fixed order (auto-save, backups, import &
 * export, danger zone), nothing wider than the 800x600 popup, and a feature's options box that
 * is only on screen while its switch is on.
 */

async function openDataTab(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: /^data$/i }).click();
}

const HEADINGS = ['Auto-save open tabs', 'Backups', 'Import & export', 'Danger zone'];

async function expectLayout(page: Page): Promise<void> {
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(HEADINGS);
  const tops: number[] = [];
  for (const name of HEADINGS) tops.push((await panel.getByRole('heading', { level: 3, name, exact: true }).boundingBox())!.y);
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);

  const overflow = await page.getByRole('dialog').evaluate((dialog) => {
    const scroller = dialog.querySelector('.overflow-y-auto') as HTMLElement | null;
    return { dialog: dialog.scrollWidth - dialog.clientWidth, scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
  });
  expect(overflow.dialog).toBeLessThanOrEqual(0);
  expect(overflow.scroller).toBeLessThanOrEqual(0);
}

test.describe('Settings → Data tab layout', () => {
  test('Free: four sections in order, no horizontal overflow, auto-save options only while on', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    await expectLayout(page);
    await expect(page.getByTestId('data-storage-footer')).toContainText('Stored on this device');

    const autoSave = page.getByRole('region', { name: 'Auto-save open tabs' });
    const toggle = autoSave.getByRole('switch', { name: 'Auto-save open tabs' });
    await expect(toggle).not.toBeChecked();
    await expect(autoSave.getByRole('combobox', { name: 'Schedule' })).toHaveCount(0);
    await toggle.click();
    await expect(autoSave.getByRole('combobox', { name: 'Schedule' })).toBeVisible();
    await expectLayout(page);
    await toggle.click();
    await expect(autoSave.getByRole('combobox', { name: 'Schedule' })).toHaveCount(0);
  });

  test('Pro: backups options box follows its switch, layout still fits', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    const backups = page.getByRole('region', { name: 'Backups', exact: true });
    const toggle = backups.getByRole('switch', { name: 'Automatic backups' });
    await expect(toggle).toBeChecked();
    await expect(backups.getByTestId('backup-options')).toBeVisible();
    await expectLayout(page);
    await toggle.click();
    await expect(backups.getByTestId('backup-options')).toHaveCount(0);
    await expectLayout(page);
  });
});
