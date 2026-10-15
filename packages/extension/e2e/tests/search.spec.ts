import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, seedSettings } from '../helpers';
import { NOW_OPEN, WORK_GROUP, tab } from '../seed';
import { SEARCH_COPY } from '@tabmerger/shared';

/** Seeds the groups and the "Tabs that do not match a search" preference, then reloads. */
async function seedWithMode(page: Page, mode: 'hide' | 'dim') {
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  await seedSettings(page, { appSettings: { searchNonMatching: mode } });
  await page.reload({ waitUntil: 'networkidle' });
}

/** Opens the search overlay and waits until its box has the focus, so typed keys reach it. */
async function openSearch(page: Page) {
  await page.getByRole('button', { name: 'Open search' }).click();
  await expect(page.getByRole('combobox', { name: SEARCH_COPY.searchInput })).toBeFocused();
}

test.describe('Search (dim mode)', () => {
  test('search with space character dims non-matching rows', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'dim');

    await page.getByRole('button', { name: 'Work', exact: true }).click();

    // Search is a button that opens an overlay with a focused input — not a persistent textbox
    await openSearch(page);
    // keyboard.type fires real keydown events — catches space-swallowing regression
    await page.keyboard.type('Jira Board');
    await page.waitForTimeout(100);

    // Matching tab: not dimmed
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toHaveClass(/opacity-60/);
    // Non-matching tab: dimmed via Tailwind opacity-60 class (not inline style)
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveClass(/opacity-60/);
  });

  test('clearing search restores all tabs to full opacity', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'dim');

    await page.getByRole('button', { name: 'Work', exact: true }).click();

    await openSearch(page);
    await page.keyboard.type('Jira');
    await page.waitForTimeout(100);

    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveClass(/opacity-60/);

    // Clear search
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    await expect(page.getByRole('listitem', { name: 'Confluence' })).not.toHaveClass(/opacity-60/);
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toHaveClass(/opacity-60/);
  });
});

test.describe('Search (hide mode, the default)', () => {
  async function search(page: Page, query: string) {
    await openSearch(page);
    await page.keyboard.type(query);
    await page.waitForTimeout(150);
  }

  test('non-matching rows are absent, matches are marked, Now Open stays with "0 found"', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'hide');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await search(page, 'Jira');

    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: /Slack/ })).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: 'Jira Board' }).locator('mark').first()).toHaveText('Jira');

    // Now Open is the way back to the live tabs: it stays in the sidebar with a "0 found" badge
    const nowOpen = page.locator('[data-sidebar-group-index="0"]');
    await expect(nowOpen).toBeVisible();
    await expect(nowOpen.getByTestId('group-search-count')).toHaveText('0 found');
  });

  test('no drag grips while rows are hidden, and Space on a row says why it cannot move', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'hide');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(page.locator('[aria-label^="Drag to reorder tab"]').first()).toBeAttached();

    await search(page, 'Jira');
    await page.keyboard.press('Escape');
    await expect(page.locator('[aria-label^="Drag to reorder tab"]')).toHaveCount(0);

    await page.getByRole('listitem', { name: 'Jira Board' }).focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#tm-dnd-live-region')).toHaveText(SEARCH_COPY.reorderLocked);
  });

  test('the query persists after the overlay closes, until it is cleared', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'hide');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await search(page, 'Jira');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveCount(0);
    await page.getByRole('button', { name: SEARCH_COPY.clearSearch }).first().click();
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Jira Board' }).locator('mark')).toHaveCount(0);
  });

  test('a focused row hidden by the search hands focus to a neighbouring row', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'hide');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await search(page, 'o'); // Jira Board, Confluence and (by its address) Slack all match
    const conf = page.getByRole('listitem', { name: 'Confluence' });
    await expect(conf).toBeVisible();

    // Focus the row, drop focus to the body, then change the query without moving focus (as an
    // assistive tool writing into the field would): the row goes and focus must not be lost.
    await conf.focus();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'Jira');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(conf).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? 'moved' : 'lost')))
      .toBe('moved');
  });
});

test.describe('Search is contiguous-only', () => {
  async function typeQuery(page: Page, query: string) {
    await openSearch(page);
    await page.keyboard.type(query);
    await page.waitForTimeout(150);
  }

  test('letters in order but not adjacent ("jra" for Jira Board) match nothing in the panel or the overlay', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'hide');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await typeQuery(page, 'jra');

    await expect(page.getByText('No matches for "jra"')).toBeVisible();
    await expect(page.getByRole('listbox', { name: 'Search results' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: 'Confluence' })).toHaveCount(0);
  });

  test('a contiguous run ("jir") lists and highlights the tab, in the overlay and the panel', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'hide');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await typeQuery(page, 'JIR');

    const option = page.getByRole('listbox', { name: 'Search results' }).getByRole('option', { name: /Jira Board/ });
    await expect(option).toBeVisible();
    await expect(option.locator('mark').first()).toHaveText('Jir');
    await page.keyboard.press('Escape');
    const row = page.getByRole('listitem', { name: 'Jira Board' });
    await expect(row).toBeVisible();
    await expect(row.locator('mark').first()).toHaveText('Jir');
  });

  test('dim mode: "jra" dims every row, "jir" leaves only the Jira row at full opacity', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedWithMode(page, 'dim');
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await typeQuery(page, 'jra');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listitem', { name: /^Jira Board/ })).toHaveClass(/opacity-60/);
    await expect(page.getByRole('listitem', { name: /^Confluence/ })).toHaveClass(/opacity-60/);

    await openSearch(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('jir');
    await expect(page.getByRole('combobox', { name: SEARCH_COPY.searchInput })).toHaveValue('jir');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).not.toHaveClass(/opacity-60/);
    await expect(page.getByRole('listitem', { name: /^Confluence/ })).toHaveClass(/opacity-60/);
  });

  test('the overlay lists a prefix match above a word-start match above a mid-word match, whatever the saved order', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    const ranked = {
      id: 'rankedgrp01',
      name: 'Ranked',
      color: 'rgba(59,130,246,1)',
      windows: [
        {
          id: 20,
          incognito: false,
          focused: false,
          tabs: [
            tab(30, 'Fajira Notes', 'https://a.example.com'),
            tab(31, 'Project Jira', 'https://b.example.com'),
            tab(32, 'Jira Board', 'https://c.example.com'),
          ],
        },
      ],
    };
    await seedAndReload(page, [NOW_OPEN, ranked]);
    await typeQuery(page, 'jira');

    const options = page.getByRole('listbox', { name: 'Search results' }).getByRole('option');
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText('Jira Board');
    await expect(options.nth(1)).toContainText('Project Jira');
    await expect(options.nth(2)).toContainText('Fajira Notes');
  });
});
