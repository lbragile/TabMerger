import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, waitForRenameInputReady } from '../helpers';
import { NOW_OPEN, WORK_GROUP, seedConfirmOnDelete, tab } from '../seed';

test.describe('Group management', () => {
  test('rename group via double-click — space bar works in input', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.locator('[data-sidebar-group-index="1"]').locator('span.truncate').dblclick();
    await waitForRenameInputReady(page);

    const input = page.getByRole('textbox');
    await input.click();
    await page.keyboard.press('Control+A');
    // keyboard.type fires real keydown events — catches space-swallowing regression
    await page.keyboard.type('Dev Work');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: 'Dev Work', exact: true })).toBeVisible();
  });

  test('rename group — Cancel button restores original name', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.locator('[data-sidebar-group-index="1"]').locator('span.truncate').dblclick();
    await waitForRenameInputReady(page);

    const input = page.getByRole('textbox');
    await input.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Should Not Save');
    // Cancel button uses onMouseDown preventDefault to avoid blur-commit, then cancels
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
    await expect(page.getByText('Should Not Save')).not.toBeVisible();
  });

  test('rename group to empty string reverts to original name', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.locator('[data-sidebar-group-index="1"]').locator('span.truncate').dblclick();
    await waitForRenameInputReady(page);

    await page.getByRole('textbox').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();
  });

  test('delete group without confirmOnDelete — immediate, no modal', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByText('Delete group').click();

    await expect(page.getByRole('button', { name: 'Work', exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

  test('delete group with confirmOnDelete — modal appears and confirms deletion', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedConfirmOnDelete(page, true);
    await page.reload({ waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Work', exact: true }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await page.getByText('Delete group').click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 3_000 });
    await modal.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('button', { name: 'Work', exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

  test('starring a group moves it above non-starred groups', async ({ context, extensionId }) => {
    const READING = {
      id: 'readinglist1',
      name: 'Reading List',
      color: 'rgba(16,185,129,1)',
      starred: false,
      windows: [{ id: 20, incognito: false, focused: false, tabs: [tab(20, 'HN', 'https://news.ycombinator.com')] }],
    };
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, { ...WORK_GROUP, starred: false }, READING]);

    const items = page.locator('[data-sidebar-group-index]');
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Work');

    // Pin button is opacity-30 until hover — hover to make it interactable
    const readingListItem = page.locator('[data-sidebar-group-index="2"]');
    await readingListItem.hover();
    await readingListItem.getByRole('button', { name: 'Pin group' }).click();

    await page.waitForTimeout(300);
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Reading List');
    expect(await items.nth(2).getAttribute('aria-label')).toBe('Work');
  });
});

test.describe('DnD zone behavior (drag no longer auto-stars)', () => {
  // The unified DnD rework deliberately DROPPED drag-to-(un)star: dragging a group
  // only reorders it, clamped to the starred/unstarred zone boundary. The dragged
  // group's `starred` flag is never mutated by the drag itself (see dndMove.ts
  // `moveGroup` + unit specs groupDnd.test.ts / dndMove.test.ts #19).
  test('dropping a plain group into the starred zone does NOT star it (clamped to boundary)', async ({ context, extensionId }) => {
    const STARRED = {
      id: 'starredgrp1',
      name: 'Starred Group',
      color: 'rgba(234,179,8,1)',
      starred: true,
      windows: [{ id: 30, incognito: false, focused: false, tabs: [tab(30, 'X', 'https://x.com')] }],
    };
    const PLAIN = {
      id: 'plaingroup01',
      name: 'Plain Group',
      color: 'rgba(100,100,100,1)',
      starred: false,
      windows: [{ id: 31, incognito: false, focused: false, tabs: [tab(31, 'Y', 'https://y.com')] }],
    };

    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, STARRED, PLAIN]);

    const items = page.locator('[data-sidebar-group-index]');
    const fromBox = await items.nth(2).getByRole('button', { name: 'Drag to reorder group' }).boundingBox();
    const toBox = await items.nth(1).boundingBox();
    if (!fromBox || !toBox) throw new Error('Bounding boxes missing');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y - 10, { steps: 5 });
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const plainStarred = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('groups', 'readonly');
          tx.objectStore('groups').get('plaingroup01').onsuccess = (e) => {
            resolve((e.target as IDBRequest).result?.starred ?? false);
          };
        };
      });
    });
    // NEW behavior: the drag never flips the flag
    expect(plainStarred).toBe(false);
    // and the starred group is still ahead of the plain one in the sidebar
    expect(await items.nth(1).getAttribute('aria-label')).toBe('Starred Group');
  });

  test('dropping a starred group into the unstarred zone does NOT un-star it', async ({ context, extensionId }) => {
    const STARRED = {
      id: 'starredgrp2',
      name: 'Was Starred',
      color: 'rgba(234,179,8,1)',
      starred: true,
      windows: [{ id: 40, incognito: false, focused: false, tabs: [tab(40, 'A', 'https://a.com')] }],
    };
    const PLAIN = {
      id: 'plaingroup02',
      name: 'Was Plain',
      color: 'rgba(100,100,100,1)',
      starred: false,
      windows: [{ id: 41, incognito: false, focused: false, tabs: [tab(41, 'B', 'https://b.com')] }],
    };

    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, STARRED, PLAIN]);

    const items = page.locator('[data-sidebar-group-index]');
    const fromBox = await items.nth(1).getByRole('button', { name: 'Drag to reorder group' }).boundingBox();
    const toBox = await items.nth(2).boundingBox();
    if (!fromBox || !toBox) throw new Error('Bounding boxes missing');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + 10, { steps: 5 });
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height - 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const stillStarred = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('groups', 'readonly');
          tx.objectStore('groups').get('starredgrp2').onsuccess = (e) => {
            resolve((e.target as IDBRequest).result?.starred ?? true);
          };
        };
      });
    });
    // NEW behavior: still starred; the engine just clamps it to the zone boundary
    expect(stillStarred).toBe(true);
  });
});
