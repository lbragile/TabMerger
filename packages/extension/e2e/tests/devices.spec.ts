import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, signInAsPro } from '../helpers';
import { NOW_OPEN } from '../seed';

test.describe('Devices settings tab (pro-tier "continue on other device")', () => {
  test('free-tier (unauthenticated) user does not see the Devices tab at all', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);

    await page.locator('header').getByRole('button').last().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page.getByRole('tab', { name: /devices/i })).toHaveCount(0);
  });

  test('pro-tier user sees the Devices tab in Settings', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN]);

    // A Pro account in its steady state: signed in, encryption set up and unlocked on this
    // device, every Supabase call stubbed (see signInAsPro) so no dialog covers the popup and
    // the result does not depend on a reachable Supabase.
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });

    await page.locator('header').getByRole('button').last().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page.getByRole('tab', { name: /devices/i })).toBeVisible();
  });
});
