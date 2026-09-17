import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Selection mode', () => {
  test('entering selection mode shows tab checkboxes', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    // Header toggle is "Select items" when off, "Exit selection mode" when on —
    // per-row selection controls are role="checkbox" named "Select <title>", not buttons.
    const selBtn = page.getByRole('button', { name: 'Select items' });
    await selBtn.click();

    await expect(page.getByRole('checkbox', { name: /^select /i }).first()).toBeVisible();

    // Exit selection mode
    await page.getByRole('button', { name: 'Exit selection mode' }).click();
    await expect(page.getByRole('button', { name: /delete selected|bulk delete/i })).not.toBeVisible();
  });

  test('bulk delete selected tabs then undo restores them', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    await page.getByRole('button', { name: /select/i }).click();

    const checkboxBtns = page.getByRole('checkbox', { name: /^select /i });
    await checkboxBtns.nth(0).click();
    await checkboxBtns.nth(1).click();

    await page.getByRole('button', { name: /delete/i }).last().click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toBeVisible({ timeout: 3_000 });

    await page.getByRole('button', { name: /undo/i }).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toBeVisible();
  });
});
