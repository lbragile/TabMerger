import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, tab } from '../seed';

const OTHER_GROUP = {
  id: 'othergrp01',
  name: 'Other',
  color: 'rgba(200,50,50,1)',
  windows: [{ id: 20, incognito: false, focused: false, tabs: [tab(20, 'Reddit', 'https://reddit.example.com')] }],
};

const liveText = (page: import('@playwright/test').Page) =>
  page.evaluate(`(document.querySelector('[id^="DndLiveRegion"]')?.textContent ?? '')`) as Promise<string>;


// Regression: Space on a focused ROW (the only Tab stop; the grip is tabIndex -1) used to
// open the tab's URL instead of starting a keyboard drag. A keyboard drag has no native
// drag session, so it runs fine in a popup.html tab.

test.describe('Keyboard drag from a focused row', () => {
  test('Space on a focused tab row picks it up (no navigation); arrows + Space reorder; Enter still opens', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const opened: string[] = [];
    context.on('page', (p) => opened.push(p.url()));

    const row = page.getByRole('listitem', { name: 'Jira Board' });
    await row.focus();
    await page.keyboard.press('Space');

    const grip = row.locator('[aria-label^="Drag to reorder tab"]');
    await expect(grip).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(grip).not.toHaveAttribute('aria-pressed', 'true');

    const titles = await page.locator('[role="listitem"][data-tab-index]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label'))
    );
    expect(titles.slice(0, 2)).toEqual(['Confluence', 'Jira Board']);
    await page.waitForTimeout(300);
    expect(opened).toEqual([]);

    // Enter on a row is still "open".
    const pagePromise = context.waitForEvent('page', { timeout: 5_000 });
    await page.getByRole('listitem', { name: 'Slack' }).focus();
    await page.keyboard.press('Enter');
    await pagePromise;
  });

  test('Escape cancels a keyboard drag started from the row', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const row = page.getByRole('listitem', { name: 'Jira Board' });
    await row.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');

    const titles = await page.locator('[role="listitem"][data-tab-index]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label'))
    );
    expect(titles.slice(0, 2)).toEqual(['Jira Board', 'Confluence']);
  });

  test('Space on a focused window header starts a drag and Escape cancels', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const header = page.locator('[data-window-header]').first();
    await header.focus();
    await page.keyboard.press('Space');
    await expect(header.locator('[aria-label^="Drag to reorder window"]')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(header.locator('[aria-label^="Drag to reorder window"]')).not.toHaveAttribute('aria-pressed', 'true');
  });

  test('ArrowDown past the last row reaches the new-window zone; Space there creates a new window', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(page.locator('[data-window-header]')).toHaveCount(2);

    await page.getByRole('listitem', { name: 'Jira Board' }).focus();
    await page.keyboard.press('Space');
    for (let i = 0; i < 6 && !/new window/.test(await liveText(page)); i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(200);
    }
    expect(await liveText(page)).toMatch(/Over a new window at the end of group Work/);
    await page.keyboard.press('Space');

    await expect(page.locator('[data-window-header]')).toHaveCount(3);
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toHaveCount(1);
  });

  test('ArrowLeft enters the sidebar at the active group; Up/Down pick a group; Space moves the tab there; ArrowRight returns', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    await page.getByRole('listitem', { name: 'Slack' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => liveText(page)).toMatch(/Over group Work, as a new window/);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => liveText(page)).toMatch(/original position/);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => liveText(page)).toMatch(/Over group Other, as a new window/);
    await page.keyboard.press('Space');

    await expect(page.getByRole('listitem', { name: 'Slack' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Slack' })).toHaveCount(1);
    await expect(page.getByRole('listitem', { name: 'Reddit' })).toHaveCount(1);
  });

  test('Escape after ArrowLeft cancels and changes nothing', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    await page.getByRole('listitem', { name: 'Slack' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => liveText(page)).toMatch(/Over group Other/);
    await page.keyboard.press('Escape');

    await expect(page.getByRole('listitem', { name: 'Slack' })).toHaveCount(1);
    await expect(page.locator('[data-window-header]')).toHaveCount(2);
    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Slack' })).toHaveCount(0);
  });

  // ── Enter is "open", never a drag key ───────────────────────────────────────

  test('Enter on a saved tab row, on a grip, and mid-drag never starts, ends or commits a drag', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    const pressed = page.locator('[aria-label^="Drag to reorder"][aria-pressed="true"]');
    const closed: string[] = [];
    context.on('page', (p) => p.on('close', () => closed.push(p.url())));

    // On the grip (where focus sits after a keyboard drop): used to START a drag.
    const row = page.getByRole('listitem', { name: 'Jira Board' });
    await row.locator('[aria-label^="Drag to reorder tab"]').focus();
    await page.keyboard.press('Enter');
    await expect(pressed).toHaveCount(0);

    // On the row: opens the tab (a new page), no drag.
    const opened = context.waitForEvent('page', { timeout: 5_000 });
    await row.focus();
    await page.keyboard.press('Enter');
    await opened;
    await expect(pressed).toHaveCount(0);

    // Mid-drag: Enter is ignored (used to DROP); only Space drops, Escape cancels.
    await page.bringToFront();
    await row.focus();
    await page.keyboard.press('Space');
    await expect(pressed).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(pressed).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(pressed).toHaveCount(0);
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Jira Board' })).toHaveCount(0);
    expect(closed).toEqual([]);
  });

  test('Enter on a Now Open tab row opens it; it neither starts a drag nor closes/moves a browser tab', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Now Open', exact: true }).click();
    const rows = page.locator('[role="listitem"][data-tab-index]');
    await expect(rows.first()).toBeVisible();
    const before = context.pages().length;
    const pressed = page.locator('[aria-label^="Drag to reorder"][aria-pressed="true"]');
    const closed: string[] = [];
    context.on('page', (p) => p.on('close', () => closed.push(p.url())));

    await rows.first().locator('[aria-label^="Drag to reorder tab"]').focus();
    await page.keyboard.press('Enter'); // on the grip: inert
    await rows.first().focus();
    await page.keyboard.press('Enter'); // on the row: opens
    await page.waitForTimeout(500);
    await expect(pressed).toHaveCount(0);
    expect(closed).toEqual([]);
    expect(context.pages().length).toBeGreaterThanOrEqual(before);
  });

  // ── no overshoot: every step is a real, distinct target; ends clamp ──────────

  test('main pane: ArrowDown past the end stays on the new-window zone; ArrowUp past the top stays on the first row (no phantom stops)', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByRole('listitem', { name: 'Jira Board' }).focus();
    await page.keyboard.press('Space');

    const seen: string[] = [];
    // Jira, Confluence, Slack, zone = 4 targets; press N+3 = 6 downs
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      seen.push(await liveText(page));
    }
    expect(seen.slice(0, 3)).toEqual([
      'Over position 2 of 2 in Window 1 of group Work.',
      'Over position 1 of 1 in Window 2 of group Work.',
      'Over a new window at the end of group Work.',
    ]);
    expect(new Set(seen.slice(2)).size).toBe(1); // stays on the zone

    const up: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(150);
      up.push(await liveText(page));
    }
    expect(up.slice(0, 3)).toEqual([
      'Over position 1 of 1 in Window 2 of group Work.',
      'Over position 2 of 2 in Window 1 of group Work.',
      'Over its original position.',
    ]);
    expect(new Set(up.slice(2)).size).toBe(1); // stays on the first row, no wrap, no window-container stop
    await page.keyboard.press('Escape');
  });

  test('sidebar: ArrowDown past the last group stays on "a new group"; ArrowUp past the top stays on Now Open', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, OTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByRole('listitem', { name: 'Jira Board' }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => liveText(page)).toMatch(/Over group Work, as a new window/);

    const down: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      down.push(await liveText(page));
    }
    expect(down[0]).toBe('Over group Other, as a new window.');
    expect(down.slice(1).every((t) => t === 'Over a new group.')).toBe(true);

    const up: string[] = [];
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(150);
      up.push(await liveText(page));
    }
    expect(up.slice(0, 2)).toEqual(['Over group Other, as a new window.', 'Over group Work, as a new window.']);
    expect(up.slice(2).every((t) => /Over Now Open/.test(t))).toBe(true);
    await page.keyboard.press('Escape');
  });
});
