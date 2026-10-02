import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, seedConfirmOnDelete } from '../seed';

/**
 * "Remove all windows" honours Settings -> "Confirm before deleting":
 *   on  -> a confirmation dialog; Cancel keeps the windows, Confirm removes them
 *   off -> removes immediately (no dialog)
 * Covered from both entry points: the sidebar group context menu and the windows panel menu.
 */

async function seedWork(page: Page, confirmOnDelete: boolean) {
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  await seedConfirmOnDelete(page, confirmOnDelete);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Jira Board' })).toBeVisible();
}

async function openSidebarMenu(page: Page) {
  await page.getByRole('button', { name: 'Work', exact: true }).click({ button: 'right' });
  const item = page.getByRole('menuitem', { name: /Remove all windows/ });
  await expect(item).toBeVisible();
  return item;
}

async function openPanelMenu(page: Page) {
  await page.getByRole('button', { name: 'More group options' }).click();
  const item = page.getByRole('menuitem', { name: /Remove all windows/ });
  await expect(item).toBeVisible();
  return item;
}

const entryPoints = [
  ['sidebar context menu', openSidebarMenu],
  ['windows panel menu', openPanelMenu],
] as const;

test.describe('Remove all windows — confirmOnDelete', () => {
  for (const [label, openMenu] of entryPoints) {
    test(`${label}: with confirmOnDelete on, Cancel keeps the windows`, async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      await seedWork(page, true);

      await (await openMenu(page)).click();

      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await expect(modal.getByRole('heading', { name: 'Remove All Windows' })).toBeVisible();
      // Nothing is deleted while the dialog is open.
      await expect(page.getByRole('listitem', { name: 'Jira Board', includeHidden: true })).toHaveCount(1); // page behind the modal is aria-hidden

      await modal.getByRole('button', { name: 'Cancel' }).click();
      await expect(modal).toBeHidden();
      await expect(page.getByRole('listitem', { name: 'Jira Board' })).toBeVisible();
      await expect(page.getByRole('listitem', { name: 'Slack' })).toBeVisible();
    });

    test(`${label}: with confirmOnDelete on, Confirm removes all windows`, async ({ context, extensionId }) => {
      const page = await openPopup(context, extensionId);
      await seedWork(page, true);

      await (await openMenu(page)).click();

      const modal = page.getByRole('dialog');
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'Remove All' }).click();

      await expect(modal).toBeHidden();
      await expect(page.getByRole('listitem', { name: 'Jira Board' })).toHaveCount(0);
      await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveCount(0);
      await expect(page.getByRole('listitem', { name: 'Slack' })).toHaveCount(0);
    });
  }

  test('with confirmOnDelete off, removes immediately and shows no dialog', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWork(page, false);

    await (await openSidebarMenu(page)).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: 'Slack' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
