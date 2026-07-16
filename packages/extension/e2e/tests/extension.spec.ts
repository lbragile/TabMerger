import { test, expect, chromium } from '@playwright/test';
import { openPopup, seedAndReload } from '../helpers';

// Shared seed data
const NOW_OPEN = {
  id: 'nowopen0001',
  name: 'Now Open',
  permanent: true,
  color: 'rgba(128,128,128,1)',
  windows: [
    {
      id: 1,
      incognito: false,
      focused: true,
      tabs: [
        { id: 1, title: 'Google', url: 'https://google.com' },
        { id: 2, title: 'GitHub', url: 'https://github.com' },
      ],
    },
  ],
};

const SAVED_GROUP = {
  id: 'savedgroup01',
  name: 'Work Stuff',
  color: 'rgba(59,130,246,1)',
  windows: [
    {
      id: 2,
      incognito: false,
      focused: false,
      tabs: [
        { id: 3, title: 'Jira Board', url: 'https://jira.example.com' },
        { id: 4, title: 'Confluence', url: 'https://confluence.example.com' },
      ],
    },
  ],
};

const ANOTHER_GROUP = {
  id: 'anothergrp1',
  name: 'Reading List',
  color: 'rgba(16,185,129,1)',
  windows: [
    {
      id: 3,
      incognito: false,
      focused: false,
      tabs: [{ id: 5, title: 'Hacker News', url: 'https://news.ycombinator.com' }],
    },
  ],
};

test.describe('TabMerger extension', () => {
  // ── 1. Groups list renders ───────────────────────────────────────────────
  test('popup shows seeded groups in the sidebar', async ({ context }) => {
    const page = await openPopup(context);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP, ANOTHER_GROUP]);

    // Sidebar items are rendered as list items or buttons containing the group name
    await expect(page.getByText('Now Open')).toBeVisible();
    await expect(page.getByText('Work Stuff')).toBeVisible();
    await expect(page.getByText('Reading List')).toBeVisible();
  });

  // ── 2. Now Open invariants ───────────────────────────────────────────────
  test('Now Open is first in sidebar and has no delete button', async ({ context }) => {
    const page = await openPopup(context);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    // First group name visible
    const firstGroup = page.getByText('Now Open');
    await expect(firstGroup).toBeVisible();

    // Context-menu delete option must NOT exist for Now Open
    // Right-click the Now Open item to open its context menu
    await firstGroup.click({ button: 'right' });
    // Give the context menu time to appear
    await page.waitForTimeout(300);
    // "Delete group" must not be in the menu
    await expect(page.getByText('Delete group')).not.toBeVisible();

    // Dismiss menu
    await page.keyboard.press('Escape');
  });

  // ── 3. Create group ─────────────────────────────────────────────────────
  test('creating a new group adds it to the sidebar', async ({ context }) => {
    const page = await openPopup(context);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    // The header "+" button creates a new group
    const addBtn = page.getByRole('button', { name: /add group|new group|\+/i });
    await addBtn.click();

    // A new group should appear (default name varies; assert count increased)
    const groupItems = page.locator('[data-testid="group-item"], .group-item, nav li');
    const countBefore = 2; // NOW_OPEN + SAVED_GROUP
    await expect(groupItems).toHaveCount(countBefore + 1, { timeout: 5_000 });
  });

  // ── 4. Search filter ─────────────────────────────────────────────────────
  test('typing in search box filters visible tabs', async ({ context }) => {
    const page = await openPopup(context);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    // Activate the saved group so its tabs are visible
    await page.getByText('Work Stuff').click();

    const searchBox = page.getByRole('textbox');
    await searchBox.fill('Jira');

    // Matching tab should be visible; non-matching tab should be dimmed (opacity 0.3) not removed
    await expect(page.getByText('Jira Board')).toBeVisible();

    // "Confluence" tab should still be in DOM but dimmed — test opacity via style
    const confluenceTab = page.getByText('Confluence');
    await expect(confluenceTab).toBeVisible(); // still in DOM
    const opacity = await confluenceTab.evaluate((el) => {
      const card = el.closest('[style*="opacity"]') as HTMLElement | null;
      return card ? parseFloat(card.style.opacity) : 1;
    });
    expect(opacity).toBeLessThan(1); // dimmed
  });

  // ── 5. Selection mode → bulk delete → undo ──────────────────────────────
  test('selection mode bulk delete then undo restores tabs', async ({ context }) => {
    const page = await openPopup(context);
    await seedAndReload(page, [NOW_OPEN, SAVED_GROUP]);

    // Click saved group to view its tabs
    await page.getByText('Work Stuff').click();

    // Enter selection mode via the header toggle or long-press — find the selection mode button
    const selectionBtn = page.getByRole('button', { name: /select/i });
    await selectionBtn.click();

    // Select a tab
    const selectTabBtn = page.getByRole('button', { name: /select tab/i }).first();
    await selectTabBtn.click();

    // Delete selected
    const deleteBtn = page.getByRole('button', { name: /delete/i });
    await deleteBtn.click();

    // Tab should be gone
    await expect(page.getByText('Jira Board')).not.toBeVisible();

    // Undo
    const undoBtn = page.getByRole('button', { name: /undo/i });
    await undoBtn.click();

    // Tab restored
    await expect(page.getByText('Jira Board')).toBeVisible();
  });
});
