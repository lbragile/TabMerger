import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Notes', () => {
  test('group note text persists after popup reload', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    // Open note via context menu on the Work sidebar item
    await page.getByRole('button', { name: 'Work' }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByText('Add note').click();

    await page.locator('textarea').fill('Remember to update docs');
    await page.getByRole('button', { name: 'Save' }).click();

    await page.reload({ waitUntil: 'networkidle' });

    // Menu item changes to "Edit note" once a note exists
    await page.getByRole('button', { name: 'Work' }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByText('Edit note').click();

    await expect(page.locator('textarea')).toHaveValue('Remember to update docs');
  });
});
