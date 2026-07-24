import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

test.describe('Search', () => {
  test('search with space character filters correctly', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    // Search is a button that opens an overlay with a focused input — not a persistent textbox
    await page.getByRole('button', { name: 'Open search' }).click();
    await page.waitForTimeout(50);
    // keyboard.type fires real keydown events — catches space-swallowing regression
    await page.keyboard.type('Jira Board');
    await page.waitForTimeout(100);

    // Matching tab: not dimmed
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toHaveClass(/opacity-30/);
    // Non-matching tab: dimmed via Tailwind opacity-30 class (not inline style)
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveClass(/opacity-30/);
  });

  test('clearing search restores all tabs to full opacity', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work' }).click();

    await page.getByRole('button', { name: 'Open search' }).click();
    await page.waitForTimeout(50);
    await page.keyboard.type('Jira');
    await page.waitForTimeout(100);

    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveClass(/opacity-30/);

    // Clear search
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toHaveClass(/opacity-30/);
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toHaveClass(/opacity-30/);
  });
});
