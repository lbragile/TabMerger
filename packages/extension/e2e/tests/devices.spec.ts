import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
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

    // ponytail: no existing e2e auth fixture — fake a signed-in session directly in
    // chrome.storage.local (the supabase storage adapter, see lib/supabase.ts) and stub
    // the REST calls useAuth/useEntitlements make, rather than building a real login flow.
    // Upgrade path: a shared `signInAs(tier)` e2e fixture if more tier-gated flows need this.
    await page.route('**/auth/v1/user*', (route) =>
      route.fulfill({ json: { id: 'e2e-user', email: 'e2e@example.com', aud: 'authenticated' } })
    );
    await page.route('**/rest/v1/subscriptions*', (route) =>
      route.fulfill({ json: [{ tier: 'pro', status: 'active', cancel_at_period_end: false, current_period_end: null, stripe_price_id: null }] })
    );

    const fakeSession = {
      access_token: 'e2e-access-token',
      refresh_token: 'e2e-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'e2e-user', email: 'e2e@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
    };
    await page.evaluate(async (session) => {
      await new Promise<void>((resolve) => {
        chrome.storage.local.set({ 'tabmerger-auth': JSON.stringify(session) }, () => resolve());
      });
    }, fakeSession);

    await page.reload({ waitUntil: 'networkidle' });

    await page.locator('header').getByRole('button').last().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page.getByRole('tab', { name: /devices/i })).toBeVisible();
  });
});
