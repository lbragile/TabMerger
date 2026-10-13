import { readFileSync } from 'fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, readStoredGroups, seedAndReload, waitForStoredGroup, type StoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Import / Export', () => {
  test('export produces a JSON file containing all group names', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    // Open user/profile dropdown → Settings → Data tab → Export
    await page.locator('header').getByRole('button').last().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await page.getByRole('tab', { name: /data/i }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 8_000 }),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);

    const path = await download.path();
    expect(path).toBeTruthy();

    const content = readFileSync(path!, 'utf-8');
    const data = JSON.parse(content);

    const names: string[] = Array.isArray(data)
      ? data.map((g: { name: string }) => g.name)
      : Object.values(data).map((g: unknown) => (g as { name: string }).name);
    expect(names).toContain('Work');
  });
});

/**
 * Importing a file (Settings → Data → Import). A file is validated entry by entry: tabs whose
 * address runs script (`javascript:`, `data:` and the like) and entries that are not groups,
 * windows or tabs are left out, everything else is stored, and the success toast says how many
 * entries were left out. Browser pages such as `chrome://extensions/` are ordinary saved tabs.
 */
test.describe('Import validation', () => {
  async function openDataTab(page: Page) {
    await page.locator('header').getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: /data/i }).click();
  }

  async function importFile(page: Page, name: string, mimeType: string, content: string) {
    // The Data tab asks "Import N groups?" in its own box (not a native confirm); the action has focus
    await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(content, 'utf-8') });
    const box = page.getByRole('alertdialog', { name: /^Import \d+ groups?\?$/ });
    await expect(box).toBeVisible();
    await expect(box.getByRole('button', { name: /^Import \d+ groups?$/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(box).toHaveCount(0);
  }

  const urlsOf = (group: StoredGroup) => group.windows.flatMap((w) => w.tabs.map((t) => t.url));

  test('JSON backup: script URLs and malformed entries are left out, the rest is saved, the toast counts them', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    const backup = [
      {
        id: 'mix0000001',
        name: 'Imported Mix',
        color: 'rgba(16,185,129,1)',
        windows: [
          {
            id: 77,
            incognito: false,
            focused: true,
            tabs: [
              { id: 501, title: 'Keep', url: 'https://keep.example.com/' },
              { id: 502, title: 'Script', url: 'JaVaScRiPt:alert(1)' },
              { id: 503, title: 'Data', url: 'data:text/html,<script>alert(1)</script>' },
              { id: 504, title: 'Extensions', url: 'chrome://extensions/' },
            ],
          },
        ],
      },
      'not a group',
      { id: 'nowopen9999', name: 'Now Open', permanent: true, windows: [] },
    ];
    await importFile(page, 'backup.json', 'application/json', JSON.stringify(backup));

    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Groups imported successfully, 3 skipped' })).toBeVisible();
    await waitForStoredGroup(page, (g) => g.name === 'Imported Mix', 'the imported group');

    const groups = await readStoredGroups(page);
    expect(groups.filter((g) => g.permanent)).toHaveLength(1);
    expect(groups.map((g) => g.name)).toEqual(['Now Open', 'Work', 'Imported Mix']);
    const imported = groups.find((g) => g.name === 'Imported Mix')!;
    expect(imported.id).not.toBe('mix0000001');
    expect(urlsOf(imported)).toEqual(['https://keep.example.com/', 'chrome://extensions/']);

    // The saved result is what the popup shows after a reload
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-sidebar-group-index]').filter({ hasText: 'Imported Mix' }).click();
    await expect(page.getByRole('listitem', { name: 'Keep' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Extensions' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Script' })).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: 'Data' })).toHaveCount(0);
  });

  test('bookmarks file: bookmarklets are left out and counted, ordinary bookmarks are saved', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    const bookmarks = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Reading List</H3>
  <DL><p>
    <DT><A HREF="https://read.example.com/">Read me</A>
    <DT><A HREF="javascript:(function(){alert(1)})()">Bookmarklet</A>
    <DT><A HREF="https://later.example.com/">Later</A>
  </DL><p>
</DL><p>`;
    await importFile(page, 'bookmarks.html', 'text/html', bookmarks);

    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Groups imported successfully, 1 skipped' })).toBeVisible();
    await waitForStoredGroup(page, (g) => g.name === 'Reading List', 'the bookmarks group');
    const group = (await readStoredGroups(page)).find((g) => g.name === 'Reading List')!;
    expect(urlsOf(group)).toEqual(['https://read.example.com/', 'https://later.example.com/']);
  });

  test('a file with nothing importable shows the error toast and saves nothing', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'onetab.txt', mimeType: 'text/plain', buffer: Buffer.from('javascript:alert(1) | One\njavascript:alert(2) | Two', 'utf-8') });

    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'No groups found' })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect((await readStoredGroups(page)).map((g) => g.name)).toEqual(['Now Open', 'Work']);
  });
});

/** The import question is the extension's own box: keyboard only, never a native dialog. */
test.describe('Import confirmation (in-app box)', () => {
  const FILE = { name: 'my-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ id: 'imp0000001', name: 'Imported One', color: 'rgba(16,185,129,1)', windows: [{ id: 1, incognito: false, focused: false, tabs: [{ id: 1, title: 'T', url: 'https://one.example.com/' }] }] }]), 'utf-8') };

  async function openDataTab(page: Page) {
    await page.locator('header').getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: /data/i }).click();
  }

  test('keyboard only: the box names the file and count, Escape cancels and keeps Settings open, focus returns to Import', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    const native: string[] = [];
    page.on('dialog', (d) => {
      native.push(d.type());
      void d.dismiss();
    });
    await openDataTab(page);

    await page.locator('input[type="file"]').setInputFiles(FILE);
    const box = page.getByRole('alertdialog', { name: 'Import 1 group?' });
    await expect(box).toBeVisible();
    await expect(box).toContainText('"my-backup.json"');
    await expect(box.getByRole('button', { name: 'Import 1 group' })).toBeFocused();
    // Tab stays inside the box
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);
    }
    const inside = await box.boundingBox();
    expect(inside!.x).toBeGreaterThanOrEqual(0);
    expect(inside!.x + inside!.width).toBeLessThanOrEqual(800);
    expect(inside!.y + inside!.height).toBeLessThanOrEqual(600);

    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /data/i })).toBeVisible(); // Settings is still open
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
    expect((await readStoredGroups(page)).map((g) => g.name)).toEqual(['Now Open', 'Work']);
    expect(native).toEqual([]);
  });

  test('Cancel imports nothing; choosing the SAME file again asks again; confirming imports it once', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    const native: string[] = [];
    page.on('dialog', (d) => {
      native.push(d.type());
      void d.dismiss();
    });
    await openDataTab(page);

    await page.locator('input[type="file"]').setInputFiles(FILE);
    const box = page.getByRole('alertdialog', { name: 'Import 1 group?' });
    await box.getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveCount(0);
    expect((await readStoredGroups(page)).map((g) => g.name)).toEqual(['Now Open', 'Work']);

    await page.locator('input[type="file"]').setInputFiles(FILE);
    await expect(box).toBeVisible();
    // a double click on the action runs the import once
    await box.getByRole('button', { name: 'Import 1 group' }).dblclick();
    await waitForStoredGroup(page, (g) => g.name === 'Imported One', 'the imported group');
    expect((await readStoredGroups(page)).filter((g) => g.name === 'Imported One')).toHaveLength(1);
    expect(native).toEqual([]);
  });

  test('a click outside the box does not dismiss it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await openDataTab(page);
    await page.locator('input[type="file"]').setInputFiles(FILE);
    const box = page.getByRole('alertdialog', { name: 'Import 1 group?' });
    await expect(box).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(box).toBeVisible();
  });
});
