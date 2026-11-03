import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, SAVED_GROUP } from '../seed';

/**
 * The ✨ button for a free account (signed out): the sparkle in full colour with a "Pro AI" tag,
 * a menu of locked actions with "Upgrade to Pro AI" at the bottom, and Settings → General's
 * "Show AI button" hiding it. Needs a build with AI on (`VITE_AI_ENABLED=true`); a build without
 * it has no AI button, and the test skips.
 */
test.describe('AI button, locked preview', () => {
  test('free: tagged button, locked actions, upgrade opens the upgrade modal; the General switch hides the button', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    const aiButton = page.getByRole('button', { name: 'AI actions, Pro AI' });
    // count() does not wait: the header must be drawn first, or a slow popup skips the test
    const accountMenu = page.locator('header').getByRole('button').last();
    await expect(accountMenu).toBeVisible();
    test.skip((await aiButton.count()) === 0, 'this build has AI off (VITE_AI_ENABLED)');
    await expect(aiButton).toBeEnabled();
    await expect(aiButton.getByTestId('header-ai-pro-tag')).toHaveText('Pro AI');

    await aiButton.click();
    const menu = page.getByTestId('header-ai-menu');
    await expect(menu).toBeVisible();
    for (const name of [/Auto-group/, /Name group/, /Describe group/, /Organize/]) {
      const item = menu.getByRole('menuitem', { name });
      await expect(item).toHaveAttribute('aria-disabled', 'true');
      await expect(item.getByTestId('header-ai-lock')).toBeVisible();
    }
    // A locked item does nothing and keeps the menu open
    // (force: Playwright never clicks an aria-disabled element on its own)
    await menu.getByRole('menuitem', { name: /Auto-group/ }).click({ force: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('header-ai-settings')).toHaveCount(0);

    await menu.getByRole('menuitem', { name: 'Upgrade to Pro AI' }).click();
    const upgrade = page.getByRole('dialog', { name: 'AI Features are Pro AI' });
    await expect(upgrade).toBeVisible();
    await upgrade.getByRole('button', { name: 'Maybe later' }).click();
    await expect(upgrade).toBeHidden();

    // Settings → General: "Show AI button" off hides it (saved, so it stays hidden after a reload)
    await accountMenu.click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: /Settings/ });
    const showAi = settings.getByRole('switch', { name: 'Show AI button' });
    await expect(showAi).toBeChecked();
    await showAi.click();
    await expect(showAi).not.toBeChecked();
    const save = settings.getByRole('button', { name: /save changes/i });
    await save.click();
    // The save is async: Save turns disabled only once the settings are written to IndexedDB.
    // A reload before that can drop the write (in CI it started 5 ms after the click and lost it).
    await expect(save).toBeDisabled();
    // Checked with Settings closed: an open dialog hides the header from the accessibility
    // tree, so the button would count 0 whether the switch worked or not
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect(page.getByRole('button', { name: 'AI actions' })).toHaveCount(0);
    await expect(page.getByTestId('header-ai-pro-tag')).toHaveCount(0);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(accountMenu).toBeVisible(); // drawn, so a count of 0 below means hidden
    await expect(page.getByRole('button', { name: 'AI actions' })).toHaveCount(0);
  });
});
