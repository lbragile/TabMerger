import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { SUPPORTED_LOCALES } from '@tabmerger/shared';
import { openPopup } from '../helpers';

/**
 * The language picker: Settings → General → Language (applied on "Save changes") and the header's
 * language menu (applied at once). The choice survives closing the popup and is already in place
 * on the next open's first render (read synchronously from localStorage), and the background
 * worker sees the same stored choice.
 */

/** An option by the language's own name (its accessible name goes on: ", German, Right-to-left"). */
const native = (name: string) => new RegExp(`^${name}(,|$)`);

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

    await page.getByTestId('settings-language').click();
    await page.getByRole('option', { name: native('Deutsch') }).click();
    // a draft until saved
    await expect(page.getByTestId('settings-language')).toContainText('Deutsch');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('button', { name: 'Sprache Deutsch' })).toBeVisible();
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
    await page.getByRole('option', { name: native('Français') }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    const button = page.getByRole('button', { name: 'Langue (FR)' });
    await expect(button).toBeVisible();

    // The header logo links to the build's website in the chosen language, always prefixed
    // (`/en` too, so the site resets its language cookie). Builds without a web
    // app URL (CI has no .env files) show the plain logo; the manifest's first trusted origin is
    // that same URL, so it tells the test which case this build is.
    const origin = await page.evaluate(() => chrome.runtime.getManifest().externally_connectable?.matches?.[0]?.replace(/\/\*$/, ''));
    const logoLink = page.locator('header').getByTestId('header-logo-link');
    if (origin) {
      await expect(logoLink).toHaveAttribute('href', `${origin}/fr`);
      await expect(logoLink).toHaveAccessibleName('Ouvrir le site web de TabMerger (nouvel onglet)');
    } else {
      await expect(logoLink).toHaveCount(0);
    }

    await button.click();
    await expect(page.getByRole('option', { name: native('Français') })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', { name: native('Langue du navigateur') }).click();
    // Playwright's Chromium runs in English
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Language (EN)' })).toBeVisible();
    if (origin) await expect(logoLink).toHaveAttribute('href', `${origin}/en`);
  });

  test('header menu: typing "heb" finds Hebrew, Enter picks it and the popup turns right to left', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    const trigger = page.getByTestId('header-language');
    await trigger.click();
    const search = page.getByRole('combobox', { name: 'Search languages by name or code' });
    await expect(search).toBeFocused();
    await search.fill('heb');
    await expect(page.getByRole('option')).toHaveCount(2); // Browser default + עברית
    await page.keyboard.press('Enter');

    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // the list of groups is now on the right of the 800px popup
    const groups = await page.locator('[data-tour="groups"]').first().boundingBox();
    expect(groups?.x ?? 0).toBeGreaterThan(500);
  });
  test('Settings: a pick is only a draft; closing without Save leaves the language unchanged', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await openSettings(page);
    await page.getByTestId('settings-language').click();
    await page.getByRole('option', { name: native('Deutsch') }).click();
    await expect(page.getByTestId('settings-language')).toContainText('Deutsch');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await page.evaluate(() => localStorage.getItem('tabmerger-locale'))).toBeNull();

    await openSettings(page);
    await expect(page.getByTestId('settings-language')).toContainText('Browser default');
  });

  test('Settings: Save of Arabic mirrors the popup and the toaster; the header menu switches back to LTR', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await openSettings(page);
    await page.getByTestId('settings-language').click();
    const search = page.getByRole('combobox', { name: 'Search languages by name or code' });
    await search.fill('arab');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // the Saved toast sits in the bottom-left corner, the end corner of a right-to-left UI
    const toaster = page.locator('[data-sonner-toaster]');
    await expect(toaster).toHaveAttribute('data-x-position', 'left');
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    expect(box?.x ?? 999).toBeLessThan(400);

    // close Settings, then the header menu goes back to English
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const groups = await page.locator('[data-tour="groups"]').first().boundingBox();
    expect(groups?.x ?? 0).toBeGreaterThan(500);

    await page.getByTestId('header-language').click();
    await page.getByRole('combobox').fill('english');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('[data-sonner-toaster]')).toHaveAttribute('data-x-position', 'right');
    const back = await page.locator('[data-tour="groups"]').first().boundingBox();
    expect(back?.x ?? 999).toBeLessThan(300);
  });

  test('the right-to-left mark is on exactly Arabic, Hebrew and Persian, in the header menu and in Settings', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    const marked = async () =>
      page.getByRole('option').evaluateAll((opts) =>
        opts.filter((o) => o.querySelector('[data-rtl-mark]')).map((o) => o.querySelector('[data-native]')?.getAttribute('lang'))
      );

    await page.getByTestId('header-language').click();
    await expect(page.getByRole('option', { name: native('עברית') })).toBeVisible();
    expect(await marked()).toEqual(['ar', 'he', 'fa']);
    // one comma-separated name, no stray space before the commas
    await expect(page.getByRole('option', { name: 'עברית, Hebrew, Right-to-left', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await openSettings(page);
    await page.getByTestId('settings-language').click();
    await expect(page.getByRole('option', { name: native('עברית') })).toBeVisible();
    expect(await marked()).toEqual(['ar', 'he', 'fa']);
  });

  // The language search's placeholder is the only hint that names and codes both work: it must be
  // fully visible (no clipping, no ellipsis) in every language, in both pickers. Measured with the
  // field empty, in the fonts the popup really uses: the placeholder's rendered width against the
  // input's content box.
  test('the language search placeholder fits in every language, in both pickers', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const page = await openPopup(context, extensionId);
    const fit = () =>
      page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('[data-testid="language-search"]');
        if (!input) return null;
        const cs = getComputedStyle(input);
        const probe = document.createElement('span');
        probe.textContent = input.placeholder;
        probe.style.cssText = `position:fixed;visibility:hidden;white-space:pre;font:${cs.font};letter-spacing:${cs.letterSpacing}`;
        probe.dir = cs.direction;
        document.body.appendChild(probe);
        const used = probe.getBoundingClientRect().width;
        probe.remove();
        const available = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { used: Math.ceil(used), available: Math.floor(available), empty: input.value === '', text: input.placeholder };
      });

    const cut: string[] = [];
    for (const lng of SUPPORTED_LOCALES) {
      await page.evaluate(async (l) => {
        localStorage.setItem('tabmerger-locale', l);
        await chrome.storage.local.set({ tm_locale: l });
      }, lng);
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('html')).toHaveAttribute('lang', lng);

      await page.getByTestId('header-language').click();
      await expect(page.getByTestId('language-search')).toBeFocused();
      const header = await fit();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('language-search')).toHaveCount(0);

      await page.locator('[data-tour="account-menu"]').click();
      await page.locator('[data-tour="menu-settings"]').click();
      await page.getByTestId('settings-language').click();
      await expect(page.getByTestId('language-search')).toBeFocused();
      const settings = await fit();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      for (const [where, m] of [['header', header], ['settings', settings]] as const) {
        expect(m, `${lng} ${where}: search box found`).not.toBeNull();
        expect(m!.empty).toBe(true);
        if (m!.used > m!.available) cut.push(`${lng} ${where}: ${m!.used}px > ${m!.available}px "${m!.text}"`);
      }
    }
    expect(cut).toEqual([]);
  });
});
