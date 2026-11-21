import fs from 'fs';
import { test, expect } from '../fixtures';
import { SUPPORTED_LOCALES } from '@tabmerger/shared';
import { openPopup } from '../helpers';

/**
 * Save session dialog → Color: "Random" and the ten palette swatches sit on ONE row in every
 * shipped locale, with nothing spilling out of the dialog. The row needs ~390px of the dialog's
 * 398px content box, so a longer "Random" label (ru "Случайный", vi "Ngẫu nhiên") or a wider gap
 * pushes the last swatch onto a line of its own. Right-to-left locales start the row at the right.
 */

/** The sidebar's "Save current session" button name in a locale (read from its catalog). */
function saveSessionLabel(lng: string): string {
  const file = new URL(`../../src/locales/${lng}/sidePanel.json`, import.meta.url);
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { saveSession: string }).saveSession;
}

test('Save session → Color: Random and all ten swatches share one row in every locale', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const page = await openPopup(context, extensionId);
  await page.setViewportSize({ width: 800, height: 600 });

  const failures: string[] = [];
  for (const lng of SUPPORTED_LOCALES) {
    await page.evaluate(async (l) => {
      localStorage.setItem('tabmerger-locale', l);
      await chrome.storage.local.set({ tm_locale: l });
    }, lng);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('lang', lng);

    await page.getByRole('button', { name: saveSessionLabel(lng), exact: true }).click();
    const group = page.getByTestId('session-color-picker');
    await expect(group).toBeVisible();
    await expect(group.getByRole('radio')).toHaveCount(11);
    // the dialog zooms in from 95%: measure once it is at full size
    await expect.poll(() => page.getByRole('dialog').evaluate((d) => getComputedStyle(d).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1,)/);

    const m = await group.evaluate((el) => {
      const dialog = el.closest('[role=dialog]') as HTMLElement;
      const ds = getComputedStyle(dialog);
      const dr = dialog.getBoundingClientRect();
      const contentLeft = dr.left + parseFloat(ds.borderLeftWidth) + parseFloat(ds.paddingLeft);
      const contentRight = dr.right - parseFloat(ds.borderRightWidth) - parseFloat(ds.paddingRight);
      const items = Array.from(el.children) as HTMLElement[];
      const rects = items.map((i) => i.getBoundingClientRect());
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const rtl = document.documentElement.dir === 'rtl';
      return {
        items: items.length,
        tops: new Set(items.map((i) => i.offsetTop)).size,
        inside: left >= contentLeft - 0.5 && right <= contentRight + 0.5,
        overflow: dialog.scrollWidth > dialog.clientWidth || el.scrollWidth > el.clientWidth,
        randomAtStart: rtl ? rects[0].right === right : rects[0].left === left,
      };
    });
    if (m.items !== 11 || m.tops !== 1 || !m.inside || m.overflow || !m.randomAtStart) failures.push(`${lng}: ${JSON.stringify(m)}`);

    await page.keyboard.press('Escape');
    await expect(group).toHaveCount(0);
  }
  expect(failures).toEqual([]);
});
