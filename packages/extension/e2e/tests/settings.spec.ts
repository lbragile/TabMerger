import { readFileSync } from 'fs';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Import / Export', () => {
  test('export produces a JSON file containing all group names', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    // Open user/profile dropdown → Settings → Data tab → Export
    await page.locator('header').getByRole('button').last().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await page.getByRole('tab', { name: /data/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    const path = await download.path();
    expect(path).toBeTruthy();

    const content = readFileSync(path!, 'utf-8');
    const data = JSON.parse(content);

    const names: string[] = Array.isArray(data)
      ? data.map((g: { name: string }) => g.name)
      : Object.values(data).map((g: unknown) => (g as { name: string }).name);
    expect(names).toContain('Work');
  });
});
