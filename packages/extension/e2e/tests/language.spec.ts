import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup } from '../helpers';

/**
 * The language picker: Settings → General → Language (applied on "Save changes") and the header's
 * language menu (applied at once). The choice survives closing the popup and is already in place
 * on the next open's first render (read synchronously from localStorage), and the background
 * worker sees the same stored choice.
 */

async function openSettings(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('Language picker', () => {
  test('Settings: Deutsch applies on Save, persists, and the next popup opens in German', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await openSettings(page);

    await page.getByRole('combobox', { name: 'Language' }).click();
    await page.getByRole('option', { name: 'Deutsch' }).click();
    // a draft until saved
    await expect(page.getByRole('combobox', { name: 'Language' })).toContainText('Deutsch');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('combobox', { name: 'Sprache' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Allgemein' })).toBeVisible();

    // the background reads the same stored choice
    const [sw] = context.serviceWorkers();
    expect(await sw.evaluate(async () => (await chrome.storage.local.get('tm_locale')).tm_locale)).toBe('de');

    await page.close();
    const again = await context.newPage();
    // Before any async storage read could have run: the first render is already German
    await again.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await expect(again.locator('html')).toHaveAttribute('lang', 'de');
    await expect(again.getByRole('button', { name: 'Sprache (DE)' })).toBeVisible();
  });

  test('header menu: a pick applies at once, Browser default goes back to the browser language', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await page.getByRole('button', { name: 'Language (EN)' }).click();
    await page.getByRole('menuitemradio', { name: 'Français' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    const button = page.getByRole('button', { name: 'Langue (FR)' });
    await expect(button).toBeVisible();

    await button.click();
    await expect(page.getByRole('menuitemradio', { name: 'Français' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: 'Langue du navigateur' }).click();
    // Playwright's Chromium runs in English
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Language (EN)' })).toBeVisible();
  });
});
