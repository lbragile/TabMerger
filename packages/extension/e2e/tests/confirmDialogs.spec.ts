import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * The sidebar "Restore session" question is the extension's own box (role `alertdialog`), never the
 * browser's `confirm()`. The other in-app questions are covered next to their flows: Import in
 * settings.spec.ts, "Replace my groups" and "Delete backup" in autoBackup.spec.ts.
 *
 * Only the declining paths run here: confirming closes every browser window, which would take the
 * test browser with it (the action itself is covered by the unit tests).
 */

async function seedSession(page: Page, name: string): Promise<void> {
  await page.evaluate(async (name) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({
          id: 'sess000001',
          name,
          createdAt: Date.now() - 60_000,
          groups: [{ id: 'sg1', name: 'Session group', color: 'rgba(59,130,246,1)', updatedAt: Date.now(), windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'A tab', url: 'https://example.com/a' }] }] }],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, name);
}

test.describe('Restore session asks in the app', () => {
  test('the box names the session, starts on Cancel, Escape and Cancel keep everything, focus returns to the button, no native dialog', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSession(page, 'Morning setup');
    await page.reload({ waitUntil: 'networkidle' });
    const native: string[] = [];
    page.on('dialog', (d) => {
      native.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
    });

    await page.getByText(/^SESSIONS \(/).click();
    const restore = page.getByRole('button', { name: 'Restore session: Morning setup' });
    await restore.focus();
    await page.keyboard.press('Enter');

    const box = page.getByRole('alertdialog', { name: 'Restore this session?' });
    await expect(box).toBeVisible();
    await expect(box).toContainText('This will close all open windows and open the tabs saved in "Morning setup" instead.');
    await expect(box.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(box.getByRole('button', { name: 'Close all windows' })).toBeFocused();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(restore).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(box).toBeVisible();
    await box.getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveCount(0);

    // nothing happened: the popup is still here with its groups
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
    expect(native).toEqual([]);
  });

  test('a click outside the box does not dismiss it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSession(page, 'Morning setup');
    await page.reload({ waitUntil: 'networkidle' });

    await page.getByText(/^SESSIONS \(/).click();
    await page.getByRole('button', { name: 'Restore session: Morning setup' }).click();
    const box = page.getByRole('alertdialog', { name: 'Restore this session?' });
    await expect(box).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(box).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
  });
});
