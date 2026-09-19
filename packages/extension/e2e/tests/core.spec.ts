import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP } from '../seed';

test.describe('Core — sidebar and basic invariants', () => {
  test('popup shows seeded groups in the sidebar', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);

    await expect(page.getByRole('button', { name: 'Now Open', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Work Stuff', exact: true })).toBeVisible();
    // 'Reading List' (12 chars > 10) is truncated in span but aria-label is untruncated
    await expect(page.getByRole('button', { name: 'Reading List', exact: true })).toBeVisible();
  });

  test('Now Open is first in sidebar and has no delete option', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await expect(page.getByRole('button', { name: 'Now Open', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Now Open', exact: true }).click({ button: 'right' });
    await page.waitForTimeout(300);
    await expect(page.getByText('Delete group')).not.toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('creating a new group adds it to the sidebar', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.getByRole('button', { name: /add group|new group|\+/i }).click();

    await expect(page.locator('[data-sidebar-group-index]')).toHaveCount(3, { timeout: 5_000 });
  });

  test('Now Open sidebar badge is visible', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    // useCurrentTabs overwrites seed data with real browser tabs — don't assert specific count
    const nowOpenItem = page.locator('[data-sidebar-group-index="0"]');
    await expect(nowOpenItem.getByText('◆')).toBeVisible();
  });

  test('dragging a sidebar group reorders it', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);

    const items = page.locator('[data-sidebar-group-index]');
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Work Stuff');
    expect(await items.nth(2).getAttribute('aria-label')).toBe('Reading List');

    // Drag must originate from the grip handle — dnd-kit listeners are only
    // attached to `[aria-label="Drag to reorder group"]`, not the whole row.
    const fromBox = await items.nth(1).getByRole('button', { name: 'Drag to reorder group' }).boundingBox();
    const toBox = await items.nth(2).boundingBox();
    if (!fromBox || !toBox) throw new Error('Could not locate group items for drag');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 + 10, { steps: 3 });
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2 + 5, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(500);
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Reading List');
    expect(await items.nth(2).getAttribute('aria-label')).toBe('Work Stuff');
  });

  test('selection mode bulk delete then undo restores tabs', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.getByRole('button', { name: 'Work Stuff', exact: true }).click();

    await page.getByRole('button', { name: /select/i }).click();
    await page.getByRole('listitem').getByRole('checkbox', { name: /^select /i }).first().click();
    await page.getByRole('button', { name: /delete/i }).click();

    await expect(page.getByText('Jira Board')).not.toBeVisible();

    await page.getByRole('button', { name: /undo/i }).click();
    await expect(page.getByText('Jira Board')).toBeVisible();
  });

  test('right-click "Rename tab" allows renaming it (double-click no longer triggers rename)', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    await page.getByRole('button', { name: 'Work Stuff', exact: true }).click();

    // Double-click must NOT enter rename mode
    await page.getByText('Jira Board').dblclick();
    await expect(page.getByRole('textbox')).not.toBeVisible();

    // Right-click → "Rename tab" is the only rename trigger
    await page.getByRole('listitem', { name: 'Jira Board' }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Rename tab' }).click();

    const input = page.getByRole('textbox');
    await input.fill('Sprint Tracker');
    await input.press('Enter');

    await expect(page.getByText('Sprint Tracker')).toBeVisible();
  });

  test('URL rule auto-assigns a new tab to the matching group', async ({ context, extensionId }) => {
    // Loads a real external page — give it more headroom than the default 30s.
    test.setTimeout(60_000);
    const page = await openPopup(context, extensionId);

    const GITHUB_GROUP = {
      id: 'githubgroup1',
      name: 'GitHub',
      color: 'rgba(59,130,246,1)',
      windows: [{ id: 10, incognito: false, focused: false, tabs: [] }],
    };
    await seedAndReload(page, [NOW_OPEN, GITHUB_GROUP]);

    await page.evaluate(() => {
      return new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('tabmerger', 1);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('settings', 'readwrite');
          // settings store uses an inline keyPath ('id') — value must carry its own
          // id field, matching localDb.ts's setSetting shape { id, value }.
          tx.objectStore('settings').put({
            id: 'urlRules',
            value: [{ id: 'rule-1', pattern: 'github.com/*', groupId: 'githubgroup1', createdAt: Date.now() }],
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    const newTab = await context.newPage();
    await newTab.goto('https://github.com/torvalds/linux', { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await newTab.waitForTimeout(1500);

    await page.reload();
    await page.getByRole('button', { name: 'GitHub', exact: true }).click();
    await expect(page.getByText(/torvalds|linux/i).first()).toBeVisible();

    await newTab.close();
  });
});
