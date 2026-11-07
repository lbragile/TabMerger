import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, signInAsPro } from '../helpers';
import { NOW_OPEN } from '../seed';

/**
 * Subscription status banner: a Pro plan that is set to end shows an amber bar with the end date
 * and a "Manage subscription" button that opens the web app's account page in a new tab.
 */

const DAY_MS = 86_400_000;

async function setUp(
  context: BrowserContext,
  extensionId: string,
  subscription: { cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null }
): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN]);
  await signInAsPro(page, 'unlocked', subscription);
  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

test.describe('Subscription status banner', () => {
  test('a cancelling Pro plan shows the end date and Manage subscription opens the account page', async ({ context, extensionId }) => {
    const page = await setUp(context, extensionId, {
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS).toISOString()
    });

    await expect(page.getByText(/^Your Pro plan ends on /)).toBeVisible();
    const manage = page.getByRole('button', { name: 'Manage subscription' });
    await expect(manage).toBeVisible();

    const [tab] = await Promise.all([context.waitForEvent('page'), manage.click()]);
    // Not waiting for the load: the web app may not be running, the URL is set at creation
    expect(tab.url().split(/[?#]/)[0]).toMatch(/\/account$/);
  });

  test('an active Pro plan that is not ending shows no banner or Manage subscription button', async ({ context, extensionId }) => {
    const page = await setUp(context, extensionId, {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date(Date.now() + 20 * DAY_MS).toISOString()
    });

    await expect(page.getByRole('button', { name: 'Manage subscription' })).toHaveCount(0);
    await expect(page.getByText(/^Your Pro plan ends on /)).toHaveCount(0);
  });
});
