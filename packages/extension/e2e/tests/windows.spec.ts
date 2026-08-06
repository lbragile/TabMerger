import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, seedConfirmOnDelete } from '../seed';

test.describe('Window management', () => {
  test('deleting a window removes it and its tabs', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    // Window delete is via MoreHorizontal dropdown — no direct delete button
    await page.getByRole('button', { name: 'More window options' }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Remove window' }).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toBeVisible({ timeout: 3_000 });
  });

  test('delete window with confirmOnDelete — modal appears', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await seedConfirmOnDelete(page, true);
    await page.reload({ waitUntil: 'networkidle' });

    await page.getByRole('button', { name: 'Work' }).click();

    await page.getByRole('button', { name: 'More window options' }).first().click();
    await page.waitForTimeout(200);
    await page.getByRole('menuitem', { name: 'Remove window' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 3_000 });
    // Confirm button says "Remove" for window deletion
    await modal.getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toBeVisible({ timeout: 3_000 });
  });

  // Regression check for a CSS-cascade bug: a global `[role="button"]:not([aria-disabled="true"])`
  // rule (globals.css) has higher specificity than Tailwind's `.cursor-grab` utility and was
  // silently forcing `cursor: pointer` on every @dnd-kit drag handle (useSortable() spreads
  // role="button" + aria-roledescription="sortable" onto handles). A jsdom/class-presence test
  // can't catch this — jsdom doesn't resolve real CSS cascade/specificity — so this asserts the
  // actual computed style in a real browser, the same way the bug was originally found.
  test('tab drag handle keeps grab cursor despite global [role="button"] cursor rule', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    const handle = page.getByLabel('Drag to reorder tab').first();
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute('role', 'button');
    await expect(handle).toHaveAttribute('aria-roledescription', 'sortable');

    const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('grab');
  });
});
