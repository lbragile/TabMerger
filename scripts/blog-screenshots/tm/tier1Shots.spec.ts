// Capture spec for the Tier-1 blog posts (manage-too-many-tabs ... onetab-alternatives): the real
// TabMerger popup, production build, 800×600 at 2x, one test per post. Same approach as
// blogShots.spec.ts (which it borrows its stubs and helpers from): real windows and tabs with
// stubbed pages, boxes measured from the live DOM right after each screenshot. Theme from
// BLOG_THEME, output folder from BLOG_OUT (one sub-folder per post slug).
//
//   BLOG_OUT=<raw> BLOG_THEME=light TM_E2E_EXT_DIR=<abs build dir> \
//     pnpm --filter @tabmerger/extension exec playwright test -c scripts/blog-screenshots/tm/playwright.tier1.config.mjs
import { expect } from '../../../packages/extension/e2e/fixtures';
import {
  DEV, NEWS, RESEARCH, THEME, TRIP, chromeGroup, dismissToasts, groupSummary, openSettingsData, openWindow, pick, popupWithGroups, settle, shot, test,
} from './shotHelpers';

test.setTimeout(180_000);

test('manage-too-many-tabs', async ({ context, extensionId }) => {
  const slug = 'manage-too-many-tabs';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, DEV);
  await openWindow(context, sw, RESEARCH);
  await openWindow(context, sw, [...TRIP, ...NEWS]);
  await settle(context, page, 'Google Scholar');
  await shot(page, slug, 'now-open', [
    { id: 'now-open-summary', label: '3 Windows ◆ 18 Tabs', locator: groupSummary(page) },
  ]);

  // Auto-save when open tabs pass a count.
  const settings = await openSettingsData(page);
  await settings.getByRole('switch', { name: /^auto-save open tabs$/i }).click();
  await page.waitForTimeout(800);
  await pick(page, settings, 'When open tabs pass', '30 open tabs');
  await dismissToasts(page);
  await shot(page, slug, 'auto-save-threshold', [
    { id: 'threshold', label: 'When open tabs pass', locator: [settings.getByText('When open tabs pass', { exact: true }), settings.getByLabel('When open tabs pass', { exact: true })] },
  ]);
});

test('tab-keyboard-shortcuts', async ({ context, extensionId }) => {
  const slug = 'tab-keyboard-shortcuts';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, DEV);
  await settle(context, page, 'Documentation | Node.js');
  // Ctrl+K needs the popup document focused; a headless window behind the others may not be.
  await page.evaluate(() => window.focus());
  await page.keyboard.press('Control+K');
  const input = page.getByPlaceholder(/^Search tabs, groups/);
  if (!(await input.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Open search' }).click();
  await expect(input).toBeFocused();
  await input.fill('docs');
  await page.waitForTimeout(700);
  await shot(page, slug, 'search', [
    { id: 'search-input', label: 'Search box', locator: page.getByRole('combobox', { name: 'Search tabs and groups' }).locator('xpath=..') },
  ]);
});

test('chrome-tab-groups', async ({ context, extensionId }) => {
  const slug = 'chrome-tab-groups';
  const { page, sw } = await popupWithGroups(context, extensionId);
  const win = await openWindow(context, sw, [...DEV.slice(0, 3), ...RESEARCH.slice(0, 3)]);
  await chromeGroup(sw, win, DEV.slice(0, 3), 'Sprint', 'blue');
  await chromeGroup(sw, win, RESEARCH.slice(0, 3), 'Thesis', 'green');
  await settle(context, page, 'Google Scholar');
  const badges = (p: Page) => p.getByRole('main').getByText(/^(Sprint|Thesis)$/);
  await shot(page, slug, 'now-open-groups', [{ id: 'group-badge', label: 'Chrome tab group badge', locator: badges(page), each: true }]);

  // Save the window, groups and all, into a TabMerger group.
  await page.getByRole('button', { name: /^Add Group$/ }).click();
  await page.waitForTimeout(500);
  const rename = page.locator('input:focus');
  if (await rename.count()) {
    await rename.fill('Sprint + thesis');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Merge with current/ }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await shot(page, slug, 'saved-groups', [{ id: 'group-badge', label: 'Chrome tab group badge', locator: badges(page), each: true }]);
});

test('restore-tabs-after-crash', async ({ context, extensionId }) => {
  const slug = 'restore-tabs-after-crash';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, TRIP);
  await settle(context, page, 'Google Maps');

  const settings = await openSettingsData(page);
  await settings.getByRole('switch', { name: /^auto-save open tabs$/i }).click();
  await page.waitForTimeout(800);
  await pick(page, settings, 'Schedule', 'Every 30 minutes');
  await dismissToasts(page);
  await shot(page, slug, 'auto-save-schedule', [
    { id: 'schedule', label: 'Schedule', locator: [settings.getByText('Schedule', { exact: true }), settings.getByLabel('Schedule', { exact: true })] },
  ]);
  await settings.getByRole('button', { name: 'Auto-save now' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await dismissToasts(page);

  // Recently closed: close three tabs.
  for (const url of TRIP.slice(1, 4)) {
    await sw.evaluate(async (u: string) => {
      const t = (await chrome.tabs.query({})).find((x) => x.url === u);
      if (t?.id) await chrome.tabs.remove(t.id);
    }, url);
    await sw.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  }
  const rc = page.getByRole('button', { name: /^recently closed \(/i });
  await expect(rc).toBeVisible();
  if ((await rc.getAttribute('aria-expanded')) !== 'true') await rc.click();
  await page.getByRole('button', { name: 'Show tabs closed today' }).click({ timeout: 15_000 });
  await expect(page.getByTestId('closed-day-view')).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, slug, 'recently-closed', [
    { id: 'today-row', label: 'Today, 3 tabs', locator: page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Show tabs closed today' }) }), fit: 'content' },
  ]);
});

test('browser-session-manager', async ({ context, extensionId }) => {
  const slug = 'browser-session-manager';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, RESEARCH);
  await settle(context, page, 'Google Scholar');
  await page.getByRole('button', { name: 'Save current session' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Session name').fill('Friday wrap-up');
  await shot(page, slug, 'save-session', [{ id: 'session-name', label: 'Session name', locator: dialog.getByLabel('Session name') }]);
  await dialog.getByRole('radio', { name: THEME === 'dark' ? 'Cyan' : 'Purple' }).check({ force: true });
  await dialog.getByRole('button', { name: /^save$/i }).click();
  await expect(dialog).toHaveCount(0);
  await dismissToasts(page);
  const sessionsToggle = page.getByRole('button', { name: /^sessions \(/i });
  if ((await sessionsToggle.getAttribute('aria-expanded')) !== 'true') await sessionsToggle.click();
  await page.getByText('Friday wrap-up').first().click();
  await page.waitForTimeout(600);
  await shot(page, slug, 'session-view', [
    { id: 'restore-session', label: 'Restore session', locator: page.getByRole('button', { name: 'Restore session', exact: true }) },
  ]);
});

test('best-tab-manager-extensions', async ({ context, extensionId }) => {
  const slug = 'best-tab-manager-extensions';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, DEV.slice(0, 4));
  await openWindow(context, sw, TRIP.slice(0, 4));
  await settle(context, page, 'Google Maps');
  await page.getByRole('button', { name: /^Add Group$/ }).click();
  await page.waitForTimeout(500);
  const rename = page.locator('input:focus');
  if (await rename.count()) {
    await rename.fill('This week');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'More group options' }).first().click();
  await page.getByRole('menuitem', { name: /Merge with current/ }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await shot(page, slug, 'saved-group', [{ id: 'summary', label: '2 Windows ◆ 8 Tabs', locator: groupSummary(page) }]);
});

test('onetab-alternatives', async ({ context, extensionId }) => {
  const slug = 'onetab-alternatives';
  const { page, sw } = await popupWithGroups(context, extensionId);
  await openWindow(context, sw, NEWS);
  await settle(context, page, 'Hacker News');
  const settings = await openSettingsData(page);
  const importButton = settings.getByRole('button', { name: 'Import file', exact: true });
  await importButton.scrollIntoViewIfNeeded();
  await shot(page, slug, 'settings-import', [{ id: 'import-file', label: 'Import file', locator: importButton }]);

  // A OneTab export: "url | title" per line, a blank line between lists.
  const oneTab = [
    'https://en.wikivoyage.org/wiki/Lisbon | Lisbon – Travel guide at Wikivoyage',
    'https://www.seat61.com/ | The Man in Seat 61 | The train travel guide',
    'https://www.timeanddate.com/weather/portugal/lisbon | Weather for Lisbon, Portugal',
    '',
    'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API | Fetch API - Web APIs | MDN',
    'https://nodejs.org/en/docs | Documentation | Node.js',
    'https://www.typescriptlang.org/docs/ | TypeScript: Documentation',
    'https://react.dev/reference/react | React Reference Overview – React',
  ].join('\n');
  await settings.locator('input[type="file"]').setInputFiles({ name: 'onetab.txt', mimeType: 'text/plain', buffer: Buffer.from(oneTab) });
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ hasText: 'Import 2 groups?' }));
  await expect(confirm.getByText('Import 2 groups?')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, slug, 'import-confirm', [
    { id: 'import-confirm', label: 'Import 2 groups', locator: confirm.getByRole('button', { name: 'Import 2 groups', exact: true }) },
  ]);
  await confirm.getByRole('button', { name: 'Import 2 groups', exact: true }).click();
  await page.waitForTimeout(1200);
  await dismissToasts(page);
  await page.getByRole('button', { name: 'Imported 2', exact: true }).click();
  await page.waitForTimeout(800);
  await shot(page, slug, 'imported-groups', [
    { id: 'imported', label: 'The imported groups', locator: [page.getByRole('button', { name: 'Imported 1', exact: true }), page.getByRole('button', { name: 'Imported 2', exact: true })], fit: 'content' },
  ]);
});
