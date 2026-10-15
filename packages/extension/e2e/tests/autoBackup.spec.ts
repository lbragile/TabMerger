import type { Page } from '@playwright/test';
import { AUTO_BACKUP_COPY } from '@tabmerger/shared';
import { test, expect } from '../fixtures';
import { openPopup, readStoredGroups, seedAndReload, seedSettings, signInAsPro } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * Automatic backups (Settings -> Data). Free and signed-out accounts see an explanation and an
 * upgrade button and no working controls. A faked Pro account (signInAsPro: signed in,
 * encryption unlocked, every page-level Supabase call stubbed) gets the switch, the interval, the
 * list with Restore / Delete, and the sidebar Sessions list never shows backups.
 *
 * Seeded backups are written straight into the `sessions` store: the schedule and the upload run
 * in the background worker, whose own network requests are not reachable by page.route(), so the
 * run itself (rotation, skip reasons, upload) is covered by the unit and integration suites.
 */

const DAY = 86_400_000;

interface SeedSession {
  id: string;
  name: string;
  createdAt: number;
  auto?: boolean;
  groups: unknown[];
}

const backupGroup = (id: string, name: string, tabs: number) => ({
  id,
  name,
  color: 'rgba(59,130,246,1)',
  updatedAt: Date.now(),
  windows: [
    {
      id: 0,
      incognito: false,
      focused: false,
      tabs: Array.from({ length: tabs }, (_, i) => ({ id: 0, title: `${name} tab ${i}`, url: `https://example.com/${id}/${i}` })),
    },
  ],
});

async function seedSessions(page: Page, sessions: SeedSession[]): Promise<void> {
  await page.evaluate(async (sessions) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('sessions', 'readwrite');
        for (const s of sessions) tx.objectStore('sessions').put(s);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, sessions);
}

async function openDataTab(page: Page): Promise<void> {
  await page.locator('header').getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: /^data$/i }).click();
}

const section = (page: Page) => page.getByRole('region', { name: AUTO_BACKUP_COPY.title });

test.describe('Automatic backups - free / signed-out', () => {
  test('a signed-out user sees the explanation and the upgrade button, with no working controls', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    const box = section(page);
    await expect(box.getByText(AUTO_BACKUP_COPY.upgradeDescription)).toBeVisible();
    await expect(box.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
    await expect(box.getByRole('switch')).toHaveCount(0);
    await expect(box.getByRole('combobox')).toHaveCount(0);
    await expect(box.getByRole('button', { name: /back up now/i })).toHaveCount(0);
  });

  test('the section does not overflow the 800x600 popup horizontally', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    const overflow = await section(page).evaluate((el) => {
      const scroller = el.closest('.overflow-y-auto') as HTMLElement | null;
      return { section: el.scrollWidth - el.clientWidth, scroller: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
    });
    expect(overflow.section).toBeLessThanOrEqual(0);
    expect(overflow.scroller).toBeLessThanOrEqual(0);
  });

  test('a lapsed account keeps its existing backups to restore, with no new-backup controls', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSessions(page, [{ id: 'bk1', name: 'Automatic backup', createdAt: Date.now() - DAY, auto: true, groups: [backupGroup('g1', 'Old work', 2)] }]);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    const box = section(page);
    await expect(box.getByText(/no longer includes automatic backups/i)).toBeVisible();
    await expect(box.getByRole('button', { name: /^Restore backup from/ })).toBeVisible();
    await expect(box.getByRole('button', { name: /back up now/i })).toHaveCount(0);
  });
});

test.describe('Automatic backups - Pro', () => {
  test('the toggle and the interval persist across a popup reopen', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    const box = section(page);
    const sw = box.getByRole('switch', { name: AUTO_BACKUP_COPY.title });
    await expect(sw).toBeChecked();
    await box.getByRole('combobox', { name: 'Backup interval' }).click();
    await page.getByRole('option', { name: 'Every 6 hours' }).click();
    await expect(box.getByRole('combobox', { name: 'Backup interval' })).toContainText('Every 6 hours');
    await sw.click();
    await expect(sw).not.toBeChecked();

    // reopen the popup: both come back from storage
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    await expect(section(page).getByRole('switch', { name: AUTO_BACKUP_COPY.title })).not.toBeChecked();
    await expect(section(page).getByRole('combobox', { name: 'Backup interval' })).toContainText('Every 6 hours');
  });

  test('old stored settings without the backup keys show the defaults: on, daily', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSettings(page, { appSettings: { theme: 'dark' } });
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    await expect(section(page).getByRole('switch', { name: AUTO_BACKUP_COPY.title })).toBeChecked();
    await expect(section(page).getByRole('combobox', { name: 'Backup interval' })).toContainText('Daily');
  });

  test('lists backups with correct counts, newest first; the sidebar Sessions list shows none of them', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSessions(page, [
      { id: 'bk-old', name: 'Automatic backup', createdAt: Date.now() - 3 * DAY, auto: true, groups: [backupGroup('g1', 'Old', 1)] },
      { id: 'bk-new', name: 'Automatic backup', createdAt: Date.now() - 60_000, auto: true, groups: [backupGroup('g2', 'Alpha', 3), backupGroup('g3', 'Beta', 2)] },
      { id: 'manual1', name: 'My saved session', createdAt: Date.now() - DAY, groups: [backupGroup('g4', 'Mine', 1)] },
    ]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    const list = section(page).getByRole('list', { name: 'Automatic backups list' });
    const items = list.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('2 groups · 5 tabs');
    await expect(items.nth(1)).toContainText('1 group · 1 tab');
    await expect(section(page).getByText(/Last backup: 1 min ago/)).toBeVisible();

    // close Settings, open the sidebar Sessions section
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /settings/i })).toHaveCount(0);
    await page.getByText(/^SESSIONS \(/).click();
    await expect(page.getByText(/^SESSIONS \(1\)/)).toBeVisible();
    await expect(page.getByText('My saved session')).toBeVisible();
    await expect(page.getByText(AUTO_BACKUP_COPY.namePrefix)).toHaveCount(0);
  });

  /** Records the browser's own confirm()/alert() if it ever opens: the questions are in-app now. */
  function watchNativeDialogs(page: Page): string[] {
    const seen: string[] = [];
    page.on('dialog', (d) => {
      seen.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
    });
    return seen;
  }

  async function openChoice(page: Page) {
    await section(page).getByRole('button', { name: /^Restore backup from/ }).first().click();
  }

  test('"Add to my groups" puts the backup groups next to the current ones, and Undo removes them again', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSessions(page, [{ id: 'bk1', name: 'Automatic backup', createdAt: Date.now() - 60_000, auto: true, groups: [backupGroup('bg1', 'Restored one', 2), backupGroup('bg2', 'Restored two', 1)] }]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    const native = watchNativeDialogs(page);

    await openChoice(page);
    await section(page).getByRole('button', { name: 'Add to my groups' }).click();

    // no question for "add"; Settings closes; the restored groups sit beside the existing one
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restored one', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restored two', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();

    await page.getByRole('button', { name: /undo/i }).click();
    await expect(page.getByRole('button', { name: 'Restored one', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restored two', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
    expect(native).toEqual([]);
  });

  test('"Replace my groups" asks in the app (keyboard only): Cancel is focused first, Tab then Enter replaces; no native dialog', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSessions(page, [{ id: 'bk1', name: 'Automatic backup', createdAt: Date.now() - 60_000, auto: true, groups: [backupGroup('bg1', 'Replacement', 2)] }]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    const native = watchNativeDialogs(page);

    await openChoice(page);
    await section(page).getByRole('button', { name: 'Replace my groups' }).click();
    const box = page.getByRole('alertdialog', { name: 'Replace your groups?' });
    await expect(box).toBeVisible();
    await expect(box).toContainText('Your 1 current group will be removed');
    await expect(box.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(box.getByRole('button', { name: 'Replace groups' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: 'Replacement', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toHaveCount(0);
    expect(native).toEqual([]);
  });

  test('declining "Replace" (Cancel, Escape, the close button) changes nothing and Settings stays open; delete asks too and removes only that backup', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSessions(page, [
      { id: 'bk1', name: 'Automatic backup', createdAt: Date.now() - 2 * DAY, auto: true, groups: [backupGroup('bg1', 'Declined group', 1)] },
      { id: 'bk2', name: 'Automatic backup', createdAt: Date.now() - DAY, auto: true, groups: [backupGroup('bg2', 'Other group', 1)] },
    ]);
    await signInAsPro(page);
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    const native = watchNativeDialogs(page);

    await openChoice(page);
    const replace = section(page).getByRole('button', { name: 'Replace my groups' });
    const box = page.getByRole('alertdialog', { name: 'Replace your groups?' });
    await replace.click();
    await box.getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveCount(0);
    await replace.click();
    // Escape is for the box: press it once the box is up (before that it would close Settings)
    await expect(box).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(section(page)).toBeVisible();
    await replace.click();
    await box.getByRole('button', { name: /close/i }).click();
    await expect(box).toHaveCount(0);
    // Settings is still open, nothing changed
    await expect(section(page)).toBeVisible();
    expect((await readStoredGroups(page)).map((g) => g.name)).toEqual(['Now Open', 'Work']);

    // delete: the question says where the backup goes, Cancel keeps it, the action removes only it
    const items = section(page).getByRole('list', { name: 'Automatic backups list' }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    const del = items.first().getByRole('button', { name: /^Delete backup from/ });
    await del.click();
    const deleteBox = page.getByRole('alertdialog', { name: 'Delete this backup?' });
    await expect(deleteBox).toContainText(AUTO_BACKUP_COPY.deleteScope);
    await expect(deleteBox).toContainText('This cannot be undone');
    await expect(deleteBox.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(deleteBox).toHaveCount(0);
    await expect(items).toHaveCount(2);
    await expect(del).toBeFocused();

    await del.click();
    await expect(deleteBox.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(deleteBox.getByRole('button', { name: 'Delete backup' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(items).toHaveCount(1);
    expect(native).toEqual([]);
  });

  test('a backup missing from the account is never deleted from this browser (empty answer, error answer), and no "Removed" line shows', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedSessions(page, [{ id: 'bk-up', name: 'Automatic backup', createdAt: Date.now() - 60_000, auto: true, uploadedAt: Date.now() - 30_000, groups: [backupGroup('g1', 'Uploaded earlier', 2)] }]);
    await signInAsPro(page);
    // the account answers a complete, EMPTY list: the backup was deleted in the web dashboard
    await page.route('**/rest/v1/sessions*', (route) => route.fulfill({ json: [] }));
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);

    const items = () => section(page).getByRole('list', { name: 'Automatic backups list' }).getByRole('listitem');
    await expect(items()).toHaveCount(1);
    await page.waitForTimeout(800); // let the download finish
    await expect(page.getByText(/^Removed \d/)).toHaveCount(0);
    await expect(items()).toHaveCount(1);

    // after a popup reopen it is still there
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    await expect(items()).toHaveCount(1);

    // and an error from the account changes nothing either
    await page.route('**/rest/v1/sessions*', (route) => route.fulfill({ status: 500, json: { message: 'e2e: down' } }));
    await page.reload({ waitUntil: 'networkidle' });
    await openDataTab(page);
    await expect(items()).toHaveCount(1);
    await expect(page.getByText(/^Removed \d/)).toHaveCount(0);
  });
});
