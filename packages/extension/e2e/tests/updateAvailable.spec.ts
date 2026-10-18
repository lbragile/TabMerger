import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * "Update available" banner. A real update can't be triggered here, so the spec seeds the record
 * the background worker writes on `runtime.onUpdateAvailable` (key mirrors
 * `UPDATE_AVAILABLE_STORAGE_KEY` in @tabmerger/shared) and checks the banner shows, keeps the
 * 800×600 popup free of outer scrollbars and the 240px sidebar seam in place, and that Dismiss
 * hides it for good. "Restart to update" (runtime.reload) is covered by unit tests: reloading the
 * extension would tear down this browser context's extension pages.
 */

const UPDATE_KEY = 'tm_update_available';
const FRAME = { width: 800, height: 600 };

async function openSizedPopup(page: Page, extensionId: string) {
  await page.setViewportSize(FRAME);
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle' });
}

/** A version one major ahead of the running build, so the banner treats it as newer. */
async function seedNewerVersion(page: Page): Promise<string> {
  return page.evaluate(async (key) => {
    const [major] = chrome.runtime.getManifest().version.split('.');
    const version = `${Number(major) + 1}.0.0`;
    await chrome.storage.local.set({ [key]: { version, detectedAt: Date.now() } });
    return version;
  }, UPDATE_KEY);
}

async function layout(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const sidebar = document.querySelector('.bg-zone-sidebar')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    return {
      overflowX: root.scrollWidth > root.clientWidth,
      overflowY: root.scrollHeight > root.clientHeight,
      sidebarWidth: sidebar?.width,
      mainLeft: main?.left,
    };
  });
}

test.describe('Update available banner', () => {
  test('shows the seeded update, keeps the layout, and Dismiss hides it for that version', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSizedPopup(page, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await expect(page.getByTestId('update-available-banner')).toHaveCount(0);
    const before = await layout(page);

    const version = await seedNewerVersion(page);
    const banner = page.getByRole('status', { name: 'Update available' });
    // the popup listens to storage changes: no reload needed
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Version ${version} is ready. Restarting closes this popup.`);
    await expect(banner.getByRole('button', { name: `Restart TabMerger to update to version ${version}. This closes the popup.` })).toBeVisible();

    const withBanner = await layout(page);
    expect(withBanner.overflowX).toBe(false);
    expect(withBanner.overflowY).toBe(false);
    expect(withBanner.sidebarWidth).toBe(240);
    expect(withBanner.sidebarWidth).toBe(before.sidebarWidth);
    expect(withBanner.mainLeft).toBe(before.mainLeft);
    const box = await banner.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(FRAME.width);

    // keyboard: Tab reaches Dismiss, Enter activates it
    const dismiss = banner.getByRole('button', { name: `Dismiss the update notice for version ${version}` });
    await dismiss.focus();
    await page.keyboard.press('Enter');
    await expect(banner).toHaveCount(0);

    // stays dismissed after the popup is opened again
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('update-available-banner')).toHaveCount(0);
  });

  test('a record for the running version is not shown', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await openSizedPopup(page, extensionId);
    await page.evaluate(async (key) => {
      await chrome.storage.local.set({ [key]: { version: chrome.runtime.getManifest().version, detectedAt: Date.now() } });
    }, UPDATE_KEY);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('main')).toBeVisible();
    await expect(page.getByTestId('update-available-banner')).toHaveCount(0);
  });
});
