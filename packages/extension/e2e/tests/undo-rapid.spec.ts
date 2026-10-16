import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, waitForStoredGroup } from '../helpers';
import { NOW_OPEN, WORK_GROUP } from '../seed';

/**
 * Rapid Undo / Redo in the real popup (docs/undo-redo-spec.md §4): clicks made faster than the
 * writes land are applied one at a time, in click order, and never show the "Your groups changed
 * elsewhere" message. The clicks are dispatched in ONE task (`page.evaluate`), so each one comes
 * before the previous one's write has landed.
 */

/** Clicks the header buttons in this order, all in the same task. */
async function clickRapidly(page: Page, buttons: Array<'Undo' | 'Redo'>): Promise<void> {
  await page.evaluate((labels) => {
    for (const label of labels) {
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!button) throw new Error(`no ${label} button`);
      button.click();
    }
  }, buttons);
}

const workTabs = async (page: Page, titles: string[]) =>
  waitForStoredGroup(
    page,
    (g) => g.id === WORK_GROUP.id && JSON.stringify(g.windows.flatMap((w) => w.tabs.map((t) => t.title)).sort()) === JSON.stringify([...titles].sort()),
    `Work holds exactly ${titles.join(', ') || 'no tabs'}`
  );

async function removeTab(page: Page, title: string): Promise<void> {
  const row = page.getByRole('listitem', { name: title });
  await row.hover();
  await row.getByRole('button', { name: 'Remove tab' }).click();
  await expect(page.getByRole('listitem', { name: title })).not.toBeVisible({ timeout: 3_000 });
}

test.describe('Undo / Redo clicked rapidly', () => {
  test('two quick Undos, two quick Redos, then Undo/Redo/Undo/Redo: each applies in order, no conflict message', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    await removeTab(page, 'Confluence');
    await removeTab(page, 'Slack');
    await workTabs(page, ['Jira Board']);

    // the second Undo is clicked before the first one's write landed
    await clickRapidly(page, ['Undo', 'Undo']);
    await workTabs(page, ['Jira Board', 'Confluence', 'Slack']);
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Slack' })).toBeVisible();

    await clickRapidly(page, ['Redo', 'Redo']);
    await workTabs(page, ['Jira Board']);

    // back one step (Slack returns), so both buttons are enabled for the burst
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await workTabs(page, ['Jira Board', 'Slack']);
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();

    // Undo (Confluence back), Redo (gone), Undo (back), Redo (gone): ends where the last Redo puts it
    await clickRapidly(page, ['Undo', 'Redo', 'Undo', 'Redo']);
    await workTabs(page, ['Jira Board', 'Slack']);
    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Slack' })).toBeVisible();

    await expect(page.getByText(/changed elsewhere/i)).toHaveCount(0);
  });
});
