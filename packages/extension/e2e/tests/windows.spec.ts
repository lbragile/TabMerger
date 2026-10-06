import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, ANOTHER_GROUP, seedConfirmOnDelete, tab } from '../seed';

test.describe('Window management', () => {
  test('deleting a window removes it and its tabs', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);

    await page.getByRole('button', { name: 'Work', exact: true }).click();

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

    await page.getByRole('button', { name: 'Work', exact: true }).click();

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

    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const handle = page.getByLabel('Drag to reorder tab').first();
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute('role', 'button');
    await expect(handle).toHaveAttribute('aria-roledescription', 'sortable');

    const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('grab');
  });

  // Computed styles and layout in a real browser: jsdom only sees the inline declarations
  // and class names, not that the tint wins over `bg-primary/10` or where the strip sits.
  test('the incognito strip follows its group’s colour and sits flush with the card’s top and sides', async ({ context, extensionId }) => {
    const incognitoGroup = (id: string, name: string, color: string, winId: number, starred = false) => ({
      id,
      name,
      color,
      windows: [{ id: winId, incognito: true, focused: false, starred, tabs: [tab(winId, `${name} tab`, 'https://example.com')] }],
    });
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [
      NOW_OPEN,
      incognitoGroup('incogred001', 'Red Private', 'rgba(239, 68, 68, 1)', 60),
      incognitoGroup('incoggreen1', 'Green Private', 'rgba(34, 197, 94, 1)', 61),
      incognitoGroup('incogblue01', 'Blue Starred', 'rgba(59, 130, 246, 1)', 62, true),
    ]);

    const label = page.getByText('Incognito', { exact: true });
    const strip = label.locator('..');
    const icon = strip.locator('svg');

    /** Gaps between the strip and the card's inner (padding-box) edges, plus the icon/grip alignment. */
    const layout = () =>
      strip.evaluate((el) => {
        const card = el.parentElement as HTMLElement;
        const c = card.getBoundingClientRect();
        const s = el.getBoundingClientRect();
        const cs = getComputedStyle(card);
        const grip = card.querySelector('[aria-label^="Drag to reorder window"]') as HTMLElement;
        const eye = el.querySelector('svg') as SVGElement;
        return {
          top: s.top - (c.top + parseFloat(cs.borderTopWidth)),
          left: s.left - (c.left + parseFloat(cs.borderLeftWidth)),
          right: c.right - parseFloat(cs.borderRightWidth) - s.right,
          cardBorderLeft: parseFloat(cs.borderLeftWidth),
          cardPaddingTop: parseFloat(cs.paddingTop),
          iconVsGrip: eye.getBoundingClientRect().left - grip.getBoundingClientRect().left,
        };
      });
    const expectFlush = async (cardBorderLeft: number) => {
      const l = await layout();
      expect(Math.abs(l.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(l.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(l.right)).toBeLessThanOrEqual(1);
      // The card keeps its own padding (header and tab rows stay inset) and its border.
      expect(l.cardPaddingTop).toBe(4);
      expect(l.cardBorderLeft).toBe(cardBorderLeft);
      // The icon lines up with the header content below it.
      expect(Math.abs(l.iconVsGrip)).toBeLessThanOrEqual(1);
      await expect(strip).toHaveCSS('border-bottom-width', '0px');
      await expect(strip).toHaveCSS('border-top-width', '0px');
    };

    await page.getByRole('button', { name: 'Red Private', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Red Private tab' })).toBeVisible();
    await expect(strip).toHaveCSS('background-color', 'rgba(239, 68, 68, 0.1)');
    await expect(icon).toHaveCSS('color', 'rgb(239, 68, 68)');
    // The label keeps the normal text colour, not the group's.
    const labelColor = await label.evaluate((el) => getComputedStyle(el).color);
    expect(labelColor).not.toBe('rgb(239, 68, 68)');
    expect(labelColor).toBe(await page.evaluate(() => getComputedStyle(document.body).color));
    await expectFlush(1);

    await page.getByRole('button', { name: 'Green Private', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Green Private tab' })).toBeVisible();
    await expect(strip).toHaveCSS('background-color', 'rgba(34, 197, 94, 0.1)');
    await expect(icon).toHaveCSS('color', 'rgb(34, 197, 94)');
    await expect(label).toHaveCSS('color', labelColor);

    // Starred: the card gains a 2px left border in the group colour; the strip sits inside it.
    await page.getByRole('button', { name: 'Blue Starred', exact: true }).click();
    await expect(page.getByRole('listitem', { name: 'Blue Starred tab' })).toBeVisible();
    await expect(strip).toHaveCSS('background-color', 'rgba(59, 130, 246, 0.1)');
    await expectFlush(2);
  });
});

// ─── Unified DnD: window → a different group's sidebar row ────────────────────

test.describe('Window drag — onto a different group (unified DnD)', () => {
  async function readGroupWindowCount(page: import('@playwright/test').Page, id: string) {
    return page.evaluate(async (gid) => {
      return new Promise<{ count: number; urls: string[] }>((resolve) => {
        const req = indexedDB.open('tabmerger', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('groups', 'readonly');
          tx.objectStore('groups').get(gid).onsuccess = (e) => {
            const g = (e.target as IDBRequest).result;
            const windows = g?.windows ?? [];
            resolve({
              count: windows.length,
              urls: windows.flatMap((w: { tabs: { url: string }[] }) => w.tabs.map((t) => t.url)),
            });
          };
        };
      });
    }, id);
  }

  test('dragging a window onto another group’s sidebar row moves it into that group', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    // WORK_GROUP has 2 windows; ANOTHER_GROUP (Reading List) has 1.
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, ANOTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();

    const before = await readGroupWindowCount(page, 'anothergrp1');
    expect(before.count).toBe(1);

    // Second window of Work holds the Slack tab. `[data-window-index]` is also on every
    // tab row, so target the window's drag handle directly (one per window).
    const slackHandle = page.getByLabel('Drag to reorder window').nth(1);
    await slackHandle.hover();
    const fromBox = await slackHandle.boundingBox();
    const toBox = await page.locator('[data-sidebar-group-index="2"]').boundingBox();
    if (!fromBox || !toBox) throw new Error('Could not locate window handle / target group row');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 + 8, { steps: 3 });
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    const target = await readGroupWindowCount(page, 'anothergrp1');
    const source = await readGroupWindowCount(page, 'workgrp0001');
    expect(target.count).toBe(2);
    expect(target.urls).toContain('https://app.slack.com');
    expect(source.count).toBe(1);
    expect(source.urls).not.toContain('https://app.slack.com');
  });

  test('spring-open: dwelling a window drag over a non-active group row opens that group', async ({
    context,
    extensionId,
  }) => {
    const page = await openPopup(context, extensionId);
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, ANOTHER_GROUP]);
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    // Work is the active group — its Slack tab is visible, Reading List's is not.
    await expect(page.getByRole('listitem', { name: 'Slack' })).toBeVisible();
    await expect(page.getByRole('listitem', { name: 'Hacker News' })).toHaveCount(0);

    // `[data-window-index]` is also on every tab row — use the window drag handle directly.
    const winHandle = page.getByLabel('Drag to reorder window').first();
    await winHandle.hover();
    const fromBox = await winHandle.boundingBox();
    const rowBox = await page.locator('[data-sidebar-group-index="2"]').boundingBox();
    if (!fromBox || !rowBox) throw new Error('Could not locate window handle / sidebar row');

    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2 + 8, { steps: 3 });
    // rest the pointer on the non-active "Reading List" row and dwell past the ~600ms threshold
    await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2, { steps: 10 });
    await page.waitForTimeout(800);

    // spring-open should have switched the active group to Reading List
    await expect(page.getByRole('listitem', { name: 'Hacker News' })).toBeVisible({ timeout: 3_000 });

    await page.mouse.up();
    await page.waitForTimeout(300);
  });
});
