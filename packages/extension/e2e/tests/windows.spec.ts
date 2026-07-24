import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, seedConfirmOnDelete } from '../seed';

test.describe('Window management', () => {
  test('deleting a window removes it and its tabs', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    // Window delete is via MoreHorizontal dropdown — no direct delete button
    await page.getByRole('button', { name: 'More window options' }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Remove window' }).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('delete window with confirmOnDelete — modal appears', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedConfirmOnDelete(page, true);
    await page.reload({ waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Work' }).click();

    await page.getByRole('button', { name: 'More window options' }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Remove window' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 3_000 });
    // Confirm button says "Remove" for window deletion
    await modal.getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toBeVisible({ timeout: 3_000 });
  });
});
