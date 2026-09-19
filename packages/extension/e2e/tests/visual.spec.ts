import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP } from '../seed';

/**
 * Visual regression tests for key popup states — Playwright's built-in
 * `toHaveScreenshot()`. Baselines live in `visual.spec.ts-snapshots/`.
 *
 * Run: `pnpm --filter @tabmerger/extension test:visual`
 * Update baselines after an intentional UI change:
 *   `pnpm --filter @tabmerger/extension test:visual -- --update-snapshots`
 *
 * Separate script from `test:e2e` — pixel diffs are slower and more
 * sensitive to OS/font rendering than the behavioral e2e suite.
 */
test.describe('Visual @visual — popup states', () => {
  test('empty state', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);

    await expect(page.getByRole('button', { name: 'Now Open', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('popup-empty.png');
  });

  test('populated with groups and tabs', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);

    await expect(page.getByRole('button', { name: 'Work Stuff', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('popup-populated.png');
  });

  test('settings modal open', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.locator('header').getByRole('button').last().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await expect(page).toHaveScreenshot('popup-settings-modal.png');
  });
});
