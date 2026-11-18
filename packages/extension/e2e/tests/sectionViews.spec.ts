import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { openPopup, seedAndReload, seedSettings } from '../helpers';
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
      const req = indexedDB.open('tabmerger');
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
    // each group is a named group with a heading, not a landmark
    await expect(view.getByRole('group', { name: 'Session group', exact: true })).toBeVisible();
    await expect(view.getByRole('region')).toHaveCount(0);

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

  test('opening a view is announced; arrows on the opener keep the view; ✕ hands focus back to the opener', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await archivedHeader(page).click();
    const opener = page.getByRole('button', { name: 'Show archived group Old Project' });
    await opener.click();
    const status = page.getByTestId('section-view-status');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText('Showing archived group Old Project, read-only');

    // Up/Down from the row that opened the view do not switch groups (which would close it)
    await opener.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('archived-view')).toBeVisible();

    await page.getByRole('button', { name: 'Close this view' }).click();
    await expect(page.getByTestId('archived-view')).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(status).toHaveText('');
  });

  test('Restore from a sidebar row is announced and focus moves on, never to the page', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await archivedHeader(page).click();
    await page.getByRole('button', { name: 'Restore Old Project' }).click();
    await expect(page.getByTestId('section-view-status')).toHaveText('Restored Old Project');
    // the only archived row left: focus goes to the section toggle
    await expect(archivedHeader(page)).toBeFocused();
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
    // a section row's current state is bold (700), a step above the group row's semibold
    await expect(archivedRow.locator('.font-bold')).toHaveCount(1);
    await expect(archivedRow.locator('.font-bold')).toHaveCSS('font-weight', '700');

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

/** A session of 10 groups x 5 windows x 10 tabs (500 tabs); group 1's second window is named "Press". */
async function seedLargeSession(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const colors = ['rgba(236, 72, 153, 1)', 'rgba(59, 130, 246, 1)', 'rgba(234, 179, 8, 1)', 'rgba(34, 197, 94, 1)', 'rgba(249, 115, 22, 1)'];
    const groups = Array.from({ length: 10 }, (_, g) => ({
      id: `big${g}`,
      name: `Group ${g + 1}`,
      color: colors[g % colors.length],
      updatedAt: 1,
      windows: Array.from({ length: 5 }, (_, w) => ({
        id: 0,
        incognito: false,
        focused: false,
        ...(g === 0 && w === 1 ? { name: 'Press' } : {}),
        tabs: Array.from({ length: 10 }, (_, t) => ({ id: 0, title: `Tab ${g + 1}.${w + 1}.${t + 1}`, url: `https://site${t}.example.com/${g}/${w}` })),
      })),
    }));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('tabmerger');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put({ id: 'sessbig001', name: 'Big session', color: 'rgba(234, 179, 8, 1)', createdAt: Date.now() - 60_000, groups });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

async function openLargeSession(context: Parameters<typeof openPopup>[0], extensionId: string, theme: 'dark' | 'light'): Promise<Page> {
  const page = await openPopup(context, extensionId);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await seedAndReload(page, [NOW_OPEN, WORK_GROUP]);
  await seedLargeSession(page);
  await seedSettings(page, { appSettings: { theme } });
  await page.evaluate((t) => localStorage.setItem('tabmerger-theme', t), theme);
  await page.reload({ waitUntil: 'networkidle' });
  await sessionsHeader(page).click();
  await page.getByRole('button', { name: 'Show session Big session' }).click();
  await expect(page.getByTestId('session-view')).toBeVisible();
  return page;
}

test.describe('Session view layout (sticky group headers, window brackets, fades)', () => {
  test('500 tabs: the group header and window tile stay at the top while scrolling; the bottom fade goes at the end', async ({ context, extensionId }) => {
    const page = await openLargeSession(context, extensionId, 'dark');
    const view = page.getByTestId('session-view');
    const scroller = view.locator('[data-faded-scroll]');
    const topFade = view.locator('[data-fade="top"]');
    const bottomFade = view.locator('[data-fade="bottom"]');

    await expect(view.getByRole('button', { name: /^Tab / })).toHaveCount(500);
    await expect(view.getByRole('group', { name: 'Group 1, Press, window 2, 10 tabs' })).toBeVisible();
    await expect(topFade).toHaveCSS('opacity', '0');
    await expect(bottomFade).toHaveCSS('opacity', '1');

    // into group 3's second window, past its first tabs
    const target = view.getByRole('group', { name: 'Group 3, window 2, 10 tabs' });
    await scroller.evaluate((el) => {
      const win = el.querySelector<HTMLElement>('[aria-label="Group 3, window 2, 10 tabs"]')!;
      el.scrollTop += win.getBoundingClientRect().top - el.getBoundingClientRect().top + 120;
    });
    const scrollTop = (await scroller.boundingBox())!.y;
    const header = view.getByRole('group', { name: 'Group 3' }).locator('[data-session-group-header]');
    await expect.poll(async () => Math.round((await header.boundingBox())!.y - scrollTop)).toBe(0);
    await expect(header.getByRole('heading', { level: 3, name: 'Group 3' })).toBeInViewport();
    // the tile sits just under the header (its height + 0.5rem), not scrolled away with the window's top
    const tile = target.locator('[data-window-tile]');
    const headerHeight = (await header.boundingBox())!.height;
    await expect.poll(async () => Math.round((await tile.boundingBox())!.y - scrollTop)).toBe(Math.round(headerHeight + 8));
    await expect(tile).toBeInViewport();
    await expect(tile).toContainText('2');
    await expect(topFade).toHaveCSS('opacity', '1');
    await expect(bottomFade).toHaveCSS('opacity', '1');

    // the end: no bottom fade, the "End of session" line
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(bottomFade).toHaveCSS('opacity', '0');
    await expect(topFade).toHaveCSS('opacity', '1');
    await expect(view.getByText('End of session · 500 tabs')).toBeInViewport();
    // no read-only banner: Restore session asks first
    await expect(view.getByRole('note')).toHaveCount(0);
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`axe finds nothing in the session view (${theme} theme)`, async ({ context, extensionId }) => {
      const page = await openLargeSession(context, extensionId, theme);
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark)/);
      const results = await new AxeBuilder({ page }).include('[data-testid="session-view"]').analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('axe finds nothing in the archived view with brackets', async ({ context, extensionId }) => {
    const page = await openWithViews(context, extensionId);
    await archivedHeader(page).click();
    await page.getByRole('button', { name: 'Show archived group Old Project' }).click();
    const view = page.getByTestId('archived-view');
    await expect(view.getByRole('group', { name: 'Old Project, window 1, 2 tabs' })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[data-testid="archived-view"]').analyze();
    expect(results.violations).toEqual([]);
  });
});
