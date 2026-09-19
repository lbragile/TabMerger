import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, seedConfirmOnDelete } from '../seed';

// Tab rename is triggered via the tab's right-click context menu ("Rename tab"),
// not double-click on the title — dblclick-to-rename was removed intentionally.
async function openRenameTab(page: import('@playwright/test').Page, tabName: string) {
  const tabRow = page.getByRole('listitem', { name: tabName });
  await tabRow.click({ button: 'right' });
  await page.waitForTimeout(200);
  await page.getByRole('menuitem', { name: 'Rename tab' }).click();
}

test.describe('Tab management', () => {
  test('rename tab custom title — space bar works in input', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await openRenameTab(page, 'Jira Board');

    const input = page.getByRole('textbox');
    await input.click();
    await page.keyboard.press('Control+A');
    // keyboard.type fires real keydown events — catches space-swallowing regression
    await page.keyboard.type('Sprint Board');
    await page.keyboard.press('Enter');

    await expect(page.getByText('Sprint Board')).toBeVisible();
    // Assert on visible text, not aria-label — the accessibility tree's computed name
    // for role="listitem" can transiently reflect both old+new text mid-update.
    await expect(page.getByText('Jira Board', { exact: true })).not.toBeVisible();
  });

  test('rename tab — Cancel button restores original title', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await openRenameTab(page, 'Jira Board');

    const input = page.getByRole('textbox');
    await input.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Should Not Save');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toBeVisible();
    await expect(page.getByText('Should Not Save')).not.toBeVisible();
  });

  test('rename tab to empty string reverts to original title', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await openRenameTab(page, 'Jira Board');

    await page.getByRole('textbox').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toBeVisible();
  });

  test('tab custom title persists after popup reload', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await openRenameTab(page, 'Confluence');

    await page.getByRole('textbox').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Wiki Home');
    await page.keyboard.press('Enter');

    // commitTitle's IDB write is fire-and-forget (not awaited by the Enter handler) —
    // wait for the renamed title to render before reloading, or the write can lose the race.
    await expect(page.getByText('Wiki Home')).toBeVisible();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    await expect(page.getByText('Wiki Home')).toBeVisible();
  });

  test('delete tab is always direct — no modal even when confirmOnDelete is on', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedConfirmOnDelete(page, true);
    await page.reload({ waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Work', exact: true }).click();

    // Tab delete button is opacity-0 until hover
    const tabRow = page.getByRole('listitem', { name: 'Jira Board' });
    await tabRow.hover();
    await tabRow.getByRole('button', { name: 'Remove tab' }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Unified DnD: cross-window tab drag inside one group ──────────────────────

test.describe('Tab drag — across windows within a group (unified DnD)', () => {
  test('dragging a tab from window 1 onto a tab in window 0 moves it into window 0', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // WORK_GROUP: window 0 = [Jira Board, Confluence], window 1 = [Slack]
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const slackRow = page.getByRole('listitem', { name: 'Slack' });
    await slackRow.hover();
    const fromBox = await slackRow.getByLabel('Drag to reorder tab').boundingBox();
    const toBox = await page.getByRole('listitem', { name: 'Jira Board' }).boundingBox();
    if (!fromBox || !toBox) throw new Error('Could not locate tab rows for drag');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 + 8, { steps: 3 });
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    // Assert against persisted IndexedDB — resilient to render timing in the panel.
    const window0Urls = await page.evaluate(async () => {
      return new Promise<string[]>((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('groups', 'readonly');
          tx.objectStore('groups').get('workgrp0001').onsuccess = (e) => {
            const g = (e.target as IDBRequest).result;
            resolve((g?.windows?.[0]?.tabs ?? []).map((t: { url: string }) => t.url));
          };
        };
      });
    });
    expect(window0Urls).toContain('https://app.slack.com');
  });
});
