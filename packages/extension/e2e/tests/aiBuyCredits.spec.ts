import type { BrowserContext, Page } from '@playwright/test';
import { ACCOUNT_AI_CREDITS_ANCHOR } from '@tabmerger/shared';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, signInAsPro } from '../helpers';
import { NOW_OPEN } from '../seed';

/**
 * Settings → AI "Buy more credits" for a Pro AI subscriber on TabMerger's key (`ai_mode:
 * 'managed'`): a link next to the credits line that opens the web app's account page at its AI
 * credits section in a new tab, shown as a button once less than 10% of the month's credits are
 * left.
 *
 * Needs a build with TabMerger's AI on (`VITE_AI_ENABLED=true`, as in a local `.env.local` dev
 * build); a build without it has no AI tab for this plan, and the test skips.
 */

const ALLOWANCE = 2500;

/** A signed-in managed Pro AI account with `used` of {@link ALLOWANCE} credits spent this month. */
async function signInAsProAiManaged(page: Page, used: number): Promise<void> {
  await signInAsPro(page);
  // Registered after signInAsPro's stubs, so these win for their tables
  await page.route('**/rest/v1/subscriptions*', (route) =>
    route.fulfill({
      json: [
        {
          tier: 'pro_ai',
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: null,
          stripe_price_id: null,
          ai_mode: 'managed',
          ai_monthly_credits: ALLOWANCE
        }
      ]
    })
  );
  await page.route('**/rest/v1/ai_usage*', (route) => route.fulfill({ json: [{ credits_used: used }] }));
}

async function openAiSettings(page: Page): Promise<boolean> {
  await page.locator('header').getByRole('button').last().click();
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  const aiTab = page.getByRole('tab', { name: /^ai$/i });
  if ((await aiTab.count()) === 0) return false;
  await aiTab.click();
  return true;
}

async function setUp(context: BrowserContext, extensionId: string, used: number): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN]);
  await signInAsProAiManaged(page, used);
  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

test.describe('Settings → AI, buy more credits', () => {
  test('a link next to the credits line opens the account page credits section in a new tab', async ({ context, extensionId }) => {
    const page = await setUp(context, extensionId, 2);
    test.skip(!(await openAiSettings(page)), "this build has TabMerger's AI off (VITE_AI_ENABLED), so there is no AI tab");

    await expect(page.getByTestId('ai-plan-line')).toHaveText('TabMerger handles setup — 2,498 of 2,500 credits left this month');
    const buy = page.getByRole('link', { name: 'Buy more credits (new tab)' });
    await expect(buy).toBeVisible();
    await expect(buy).toHaveText('Buy more credits');
    await expect(buy).toHaveAttribute('data-emphasis', 'normal');

    const href = await buy.getAttribute('href');
    expect(href).toMatch(new RegExp(`^https?://[^/]+/account#${ACCOUNT_AI_CREDITS_ANCHOR}$`));

    // Record what the popup asks the tabs API for (and still open it): the tab's own URL depends on
    // whether a web app is running and where it redirects a signed-out visitor
    await page.evaluate(() => {
      const created: chrome.tabs.CreateProperties[] = [];
      const original = chrome.tabs.create.bind(chrome.tabs);
      (globalThis as unknown as { __tmCreated: typeof created }).__tmCreated = created;
      chrome.tabs.create = ((props: chrome.tabs.CreateProperties) => {
        created.push(props);
        return original(props);
      }) as typeof chrome.tabs.create;
    });
    const [tab] = await Promise.all([context.waitForEvent('page'), buy.click()]);
    const created = await page.evaluate(() => (globalThis as unknown as { __tmCreated: chrome.tabs.CreateProperties[] }).__tmCreated);
    expect(created).toEqual([{ url: href, active: true }]);
    await tab.close();
  });

  test('below 10% of the month’s credits it is a button', async ({ context, extensionId }) => {
    // 200 of 2,500 left: under the 250 that is 10%
    const page = await setUp(context, extensionId, 2300);
    test.skip(!(await openAiSettings(page)), "this build has TabMerger's AI off (VITE_AI_ENABLED), so there is no AI tab");

    await expect(page.getByTestId('ai-plan-line')).toHaveText('TabMerger handles setup — 200 of 2,500 credits left this month');
    const buy = page.getByRole('link', { name: 'Buy more credits (new tab)' });
    await expect(buy).toHaveAttribute('data-emphasis', 'low');
    // fits the fixed-width popup: the Settings dialog does not scroll sideways
    const overflow = await page.getByRole('dialog').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
