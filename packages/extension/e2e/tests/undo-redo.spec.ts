import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Undo / Redo', () => {
  test('undo after tab delete restores it, redo removes it again', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const tabRow = page.getByRole('listitem', { name: 'Confluence' });
    await tabRow.hover();
    await tabRow.getByRole('button', { name: 'Remove tab' }).click();
    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toBeVisible({ timeout: 3_000 });

    await page.getByRole('button', { name: /undo/i }).click();
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toBeVisible();

    await page.getByRole('button', { name: /redo/i }).click();
    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toBeVisible({ timeout: 3_000 });
  });
});
