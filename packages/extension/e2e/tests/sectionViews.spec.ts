import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload } from '../helpers';
import { NOW_OPEN, WORK_GROUP, ANOTHER_GROUP, tab } from '../seed';

/**
 * Read-only views of the sidebar's Archived and Sessions rows, opened in the main panel:
 * archived group -> view -> Restore shows it as a normal group; session -> view -> "Restore
 * session" asks first (only the declining path runs: confirming closes every browser window);
 * ✕ goes back; the bottom sections are an accordion; only the item shown in the main panel is the
 * current row (aria-current + semibold); a locked group row's tooltip is rendered outside the
 * sidebar (so the scrollbar and the dimmed row cannot cover it).
 */

const ARCHIVED = {
  id: 'archivedgr1',
  name: 'Old Project',
  color: 'rgba(239,68,68,1)',
  archived: true,
  windows: [{ id: 5, incognito: false, focused: false, tabs: [tab(7, 'Spec Doc', 'https://spec.example.com'), tab(8, 'Board', 'https://board.example.com')] }],
};

async function seedSession(page: Page, name: string): Promise<void> {
  await page.evaluate(async (name) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({
          id: 'sess000002',
          name,
          createdAt: Date.now() - 60_000,
          groups: [{ id: 'sg2', name: 'Session group', color: 'rgba(59,130,246,1)', updatedAt: Date.now(), windows: [{ id: 0, incognito: false, focused: false, tabs: [{ id: 0, title: 'Session tab', url: 'https://example.com/a' }] }] }],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, name);
}

const archivedHeader = (page: Page) => page.getByRole('button', { name: /^archived \(/i });
const sessionsHeader = (page: Page) => page.getByRole('button', { name: /^sessions \(/i });

async function openWithViews(context: Parameters<typeof openPopup>[0], extensionId: string): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP, ARCHIVED]);
  await seedSession(page, 'Morning setup');
  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

test.describe('Sidebar section views', () => {
  test('an archived group opens read-only; Restore shows it as a normal group', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await archivedHeader(page).click();
    await page.getByRole('button', { name: 'Show archived group Old Project' }).click();

    const view = page.getByTestId('archived-view');
    await expect(view).toBeVisible();
    await expect(view.getByRole('heading', { level: 2, name: 'Old Project' })).toBeVisible();
    await expect(view.getByRole('note')).toContainText('Read-only');
    await expect(view.getByRole('button', { name: /Spec Doc/ })).toBeVisible();

    await view.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(view).toHaveCount(0);
    const row = page.locator('[data-sidebar-group-index]').filter({ hasText: 'Old Project' });
    await expect(row).toHaveAttribute('aria-current', 'page');
    // a normal group now: its tabs are in the editable windows panel
    await expect(page.getByRole('listitem', { name: 'Spec Doc' })).toBeVisible();
  });

  test('a session opens read-only; "Restore session" asks first and Cancel keeps everything', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await sessionsHeader(page).click();
    await page.getByRole('button', { name: 'Show session Morning setup' }).click();

    const view = page.getByTestId('session-view');
    await expect(view).toBeVisible();
    await expect(view.getByRole('heading', { level: 2, name: 'Morning setup' })).toBeVisible();
    await expect(view.getByRole('region', { name: 'Session group' })).toBeVisible();

    await view.getByRole('button', { name: 'Restore session', exact: true }).click();
    const box = page.getByRole('alertdialog', { name: 'Restore this session?' });
    await expect(box).toBeVisible();
    await box.getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveCount(0);
    await expect(view).toBeVisible();
  });

  test('✕ goes back to the group shown before', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await page.locator('[data-sidebar-group-index]').filter({ hasText: 'Work' }).click();
    await archivedHeader(page).click();
    await page.getByRole('button', { name: 'Show archived group Old Project' }).click();
    await expect(page.getByTestId('archived-view')).toBeVisible();

    await page.getByRole('button', { name: 'Close this view' }).click();
    await expect(page.getByTestId('archived-view')).toHaveCount(0);
    await expect(page.locator('[data-sidebar-group-index]').filter({ hasText: 'Work' })).toHaveAttribute('aria-current', 'page');
  });

  test('the bottom sections are an accordion: opening one closes the other', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await archivedHeader(page).click();
    await expect(archivedHeader(page)).toHaveAttribute('aria-expanded', 'true');
    await sessionsHeader(page).click();
    await expect(sessionsHeader(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(archivedHeader(page)).toHaveAttribute('aria-expanded', 'false');
    await archivedHeader(page).click();
    await expect(sessionsHeader(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('only the item shown in the main panel is current: Now Open loses current and bold while a view shows', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    const nowOpen = page.locator('[data-sidebar-group-index="0"]');
    await expect(nowOpen).toHaveAttribute('aria-current', 'page');
    await expect(nowOpen.locator('.font-semibold')).toHaveCount(1);

    await archivedHeader(page).click();
    const archivedRow = page.getByRole('button', { name: 'Show archived group Old Project' });
    await archivedRow.click();
    await expect(nowOpen).not.toHaveAttribute('aria-current', /.*/);
    await expect(nowOpen.locator('.font-semibold')).toHaveCount(0);
    await expect(archivedRow).toHaveAttribute('aria-current', 'page');
    await expect(archivedRow.locator('.font-semibold')).toHaveCount(1);

    // picking a group row makes it current again and clears the view's row
    await nowOpen.click();
    await expect(nowOpen).toHaveAttribute('aria-current', 'page');
    await expect(archivedRow).not.toHaveAttribute('aria-current', /.*/);
    await expect(page.getByTestId('archived-view')).toHaveCount(0);
  });

  test('a locked group row\'s tooltip is attached outside the sidebar, above its scrollbar', async ({ context, extensionId }) => {
    const page = await openPopup(context, extensionId);
    // Free plan: 5 saved groups; the sixth is locked
    const extras = ['One', 'Two', 'Three', 'Four'].map((n, i) => ({ ...ANOTHER_GROUP, id: `extra${i}`, name: `Extra ${n}` }));
    await seedAndReload(page, [NOW_OPEN, WORK_GROUP, ANOTHER_GROUP, ...extras, { ...ANOTHER_GROUP, id: 'lockedgrp1', name: 'Locked One' }]);

    const locked = page.locator('[data-sidebar-group-index]').filter({ hasText: 'Locked One' });
    await locked.scrollIntoViewIfNeeded();
    await locked.getByLabel('Pro required').hover();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    const attachedToBody = await tooltip.evaluate((el) => {
      const wrapper = el.closest('[data-radix-popper-content-wrapper]');
      return wrapper?.parentElement === document.body;
    });
    expect(attachedToBody).toBe(true);
    expect(await tooltip.evaluate((el) => !!el.closest('[data-sidebar-group-index]'))).toBe(false);
  });
});
