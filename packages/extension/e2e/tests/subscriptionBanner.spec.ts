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

    // Record what the popup asks the tabs API for (and still open it): the new tab's own URL is
    // chrome-error:// when no web app is running (as in CI), so it can't be asserted on
    await page.evaluate(() => {
      const created: chrome.tabs.CreateProperties[] = [];
      const original = chrome.tabs.create.bind(chrome.tabs);
      (globalThis as unknown as { __tmCreated: typeof created }).__tmCreated = created;
      chrome.tabs.create = ((props: chrome.tabs.CreateProperties) => {
        created.push(props);
        return original(props);
      }) as typeof chrome.tabs.create;
    });
    const [tab] = await Promise.all([context.waitForEvent('page'), manage.click()]);
    const created = await page.evaluate(() => (globalThis as unknown as { __tmCreated: chrome.tabs.CreateProperties[] }).__tmCreated);
    expect(created).toHaveLength(1);
    expect(created[0].url).toMatch(/^https?:\/\/[^/]+\/account$/);
    await tab.close();
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
