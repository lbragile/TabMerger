import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup } from '../helpers';
import { SEARCH_COPY } from '@tabmerger/shared';

/**
 * Settings dropdowns under the Firefox popup's `resize` behaviour.
 *
 * Firefox sizes a browser-action popup to its content: after DOM changes it measures the page
 * again, and the popup window fires `resize` even when its size did not change. Radix Select
 * closes on every window `resize`, so in Firefox every Settings dropdown closed the moment it
 * opened. The suite runs in Chromium (Playwright can't open a Firefox action popup), so the spec
 * reproduces that behaviour in the page: a MutationObserver fires a same-size `resize` after DOM
 * changes, at most once per 50ms (Firefox measures again on mutations, debounced). With it on,
 * the dropdowns must still open, stay open and take a choice, by mouse and by keyboard.
 */

/** Starts firing same-size `resize` events after DOM changes, the way a Firefox popup does. */
async function emulateFirefoxPopupResizes(page: Page): Promise<void> {
  await page.evaluate(() => {
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        window.dispatchEvent(new Event('resize'));
      }, 50);
    }).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('Settings dropdowns with Firefox-style same-size resizes', () => {
  test('the theme dropdown opens by mouse, stays open and saves a choice', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await emulateFirefoxPopupResizes(page);
    await openSettings(page);

    await page.getByRole('combobox', { name: 'Theme' }).click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    // Several emulated resizes fire while the list is open (opening it changed the DOM).
    await page.waitForTimeout(400);
    await expect(listbox).toBeVisible();

    await page.getByRole('option', { name: 'Dark' }).click();
    await expect(listbox).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Theme' })).toContainText('Dark');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('the search dropdown opens by keyboard, Escape closes it and focus returns', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await emulateFirefoxPopupResizes(page);
    await openSettings(page);

    const trigger = page.getByRole('combobox', { name: SEARCH_COPY.settingLabel });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await page.waitForTimeout(400);
    await expect(listbox).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Open again with ArrowDown and pick with the keyboard. Read the current value first: the
    // open list hides the trigger from role queries. Radix moves arrow-key focus in a timer, so
    // wait for the option to have it before pressing Enter.
    const current = (await trigger.textContent())?.trim();
    const other = current === 'Hide' ? 'Dim' : 'Hide';
    await page.keyboard.press('ArrowDown');
    await expect(listbox).toBeVisible();
    await page.waitForTimeout(400);
    await expect(listbox).toBeVisible();
    await page.keyboard.press(current === 'Hide' ? 'ArrowDown' : 'ArrowUp');
    await expect(page.getByRole('option', { name: other })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(listbox).toHaveCount(0);
    await expect(trigger).toContainText(other);
  });
});
